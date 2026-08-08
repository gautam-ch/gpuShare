"""
Host Agent - Vast-Clone GPU Sharing
====================================
- Sends heartbeats every 15s to the backend with GPU stats + Tailscale IP
- Runs a small Flask HTTP server on port 9000 to receive Docker launch commands

Source: pynvml, docker-py, flask boilerplates (open-source)
"""

import time
import requests
import subprocess
import uuid
import os
import threading

# ---- CONDITIONAL GPU IMPORT ----
try:
    import pynvml
    GPU_AVAILABLE = True
except ImportError:
    GPU_AVAILABLE = False

# ---- FLASK FOR RECEIVING COMMANDS ----
try:
    from flask import Flask, request as flask_request, jsonify
    import docker
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000/heartbeat")
if not BACKEND_URL.endswith("/heartbeat"):
    BACKEND_URL = BACKEND_URL.rstrip("/") + "/heartbeat"

# Generate or load a stable machine ID
MACHINE_ID_FILE = "machine_id.txt"
if os.path.exists(MACHINE_ID_FILE):
    with open(MACHINE_ID_FILE, 'r') as f:
        MACHINE_ID = f.read().strip()
else:
    MACHINE_ID = f"node-{uuid.uuid4().hex[:6]}"
    with open(MACHINE_ID_FILE, 'w') as f:
        f.write(MACHINE_ID)


def get_tailscale_ip():
    """Automatically retrieve this machine's Tailscale IPv4 address."""
    cmd_candidates = [
        ['tailscale', 'ip', '-4'],
        [r'C:\Program Files\Tailscale\tailscale.exe', 'ip', '-4']
    ]
    for cmd in cmd_candidates:
        try:
            result = subprocess.run(
                cmd,
                capture_output=True, text=True, check=True
            )
            ip = result.stdout.strip()
            if ip:
                return ip
        except Exception:
            continue
    return "127.0.0.1"


def get_gpu_stats():
    """Return VRAM stats using pynvml. Falls back to mock if no GPU."""
    if not GPU_AVAILABLE:
        return {"vram_total_mb": 8192, "vram_free_mb": 8192, "cpus": 4}
    pynvml.nvmlInit()
    try:
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        return {
            "vram_total_mb": info.total / 1024**2,
            "vram_free_mb": info.free / 1024**2,
            "cpus": os.cpu_count() or 4
        }
    finally:
        pynvml.nvmlShutdown()


def send_heartbeat():
    """Send a heartbeat payload to the backend and handle dispatched jobs."""
    stats = get_gpu_stats()
    tailscale_ip = get_tailscale_ip()
    payload = {
        "machine_id": MACHINE_ID,
        "tailscale_ip": tailscale_ip,
        "status": "online",
        **stats
    }
    try:
        resp = requests.post(BACKEND_URL, json=payload, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            dispatched = data.get("jobs", [])
            for job in dispatched:
                j_id = str(job.get("job_id"))
                t_token = job.get("token")
                print(f"[Agent] Received new job #{j_id}! Starting Jupyter background task...")
                threading.Thread(target=_launch_jupyter_bg, args=(j_id, t_token, tailscale_ip), daemon=True).start()

            print(f"[{time.strftime('%X')}] Heartbeat → 200 | VRAM free: {stats['vram_free_mb']:.0f}MB | IP: {tailscale_ip}")
        else:
            print(f"[{time.strftime('%X')}] Heartbeat → {resp.status_code} | VRAM free: {stats['vram_free_mb']:.0f}MB")
    except Exception as e:
        print(f"[{time.strftime('%X')}] Heartbeat FAILED: {e}")


def heartbeat_loop():
    """Background thread: send heartbeats every 3 seconds to quickly pick up jobs."""
    print(f"[Agent] Starting. Machine ID: {MACHINE_ID}")
    while True:
        send_heartbeat()
        time.sleep(3)


# ---- FLASK COMMAND SERVER ----
if FLASK_AVAILABLE:
    flask_app = Flask(__name__)

    def start_cloudflare_tunnel(port: int, machine_ip: str = "127.0.0.1") -> str:
        """
        Start a Cloudflare quick tunnel (no account needed).
        For localhost testing, skip the tunnel and return localhost URL directly.
        For remote machines, create a public tunnel.
        Source: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/
        """
        import platform, re, queue, threading as _th

        # LOCAL SHORTCUT: skip Cloudflare for localhost testing
        if machine_ip in ("127.0.0.1", "localhost"):
            print(f"[Agent] Local mode: using http://localhost:{port} directly (no tunnel needed)")
            return f"http://localhost:{port}"

        system = platform.system().lower()
        cf_binary = os.path.expanduser("~/cloudflared")
        if system == "windows":
            cf_binary += ".exe"

        if not os.path.exists(cf_binary):
            print("[Agent] Downloading cloudflared...")
            arch = "amd64"
            if system == "linux":
                url = f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}"
            elif system == "darwin":
                url = f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-{arch}.tgz"
            else:
                url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
            r = requests.get(url, stream=True)
            with open(cf_binary, 'wb') as f:
                for chunk in r.iter_content(8192):
                    f.write(chunk)
            if system != "windows":
                os.chmod(cf_binary, 0o755)
            print("[Agent] cloudflared downloaded.")

        proc = subprocess.Popen(
            [cf_binary, "tunnel", "--url", f"http://localhost:{port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace"
        )

        # Read both stdout and stderr — cloudflared has changed which stream it uses across versions
        found_q = queue.Queue()
        url_pattern = re.compile(r'https://[a-zA-Z0-9\-]+\.trycloudflare\.com')

        def _reader(stream):
            try:
                for line in stream:
                    m = url_pattern.search(line)
                    if m:
                        found_q.put(m.group(0))
                        return
            except Exception:
                pass

        _th.Thread(target=_reader, args=(proc.stdout,), daemon=True).start()
        _th.Thread(target=_reader, args=(proc.stderr,), daemon=True).start()

        try:
            public_url = found_q.get(timeout=30)  # wait up to 30s
        except queue.Empty:
            proc.kill()
            raise RuntimeError("Cloudflare tunnel did not produce a URL within 30s")

        print(f"[Agent] Cloudflare tunnel active: {public_url}")
        return public_url

    # In-memory job store: job_id -> {"status": "pending|done|error", "public_url": str}
    job_store: dict = {}

    def _launch_jupyter_bg(job_id: str, token: str, machine_ip: str = "127.0.0.1"):
        """Background thread: pull image, start container, create Cloudflare tunnel."""
        try:
            client = docker.from_env()

            # Auto-cleanup: remove any existing container using port 8888 or with same name
            container_name = f"jupyter-{token[:8]}"
            for c in client.containers.list(all=True):
                ports = c.ports or {}
                using_8888 = any("8888" in str(k) for k in ports)
                same_name = c.name == container_name
                if using_8888 or same_name:
                    print(f"[Agent] Removing existing container: {c.name}")
                    try:
                        c.stop(timeout=3)
                        c.remove(force=True)
                    except Exception:
                        pass

            device_requests = []
            if GPU_AVAILABLE:
                device_requests = [docker.types.DeviceRequest(count=-1, capabilities=[['gpu']])]

            print(f"[Agent] [{job_id}] Pulling/starting jupyter/tensorflow-notebook ...")
            container = client.containers.run(
                "jupyter/tensorflow-notebook",
                detach=True,
                ports={"8888/tcp": 8888},
                environment={"JUPYTER_TOKEN": token, "GRANT_SUDO": "yes"},
                device_requests=device_requests,
                remove=True,
                name=container_name,
                command=[
                    "start-notebook.sh",
                    f"--NotebookApp.token={token}",
                    "--NotebookApp.allow_origin=*",
                    "--NotebookApp.allow_remote_access=True",
                    "--NotebookApp.tornado_settings={\"headers\":{\"Content-Security-Policy\":\"frame-ancestors *\"}}",
                    "--NotebookApp.disable_check_xsrf=True",
                ]
            )
            print(f"[Agent] [{job_id}] Container up: {container.short_id}")

            # Give Jupyter a moment to bind to port 8888
            time.sleep(5)

            # Start Cloudflare quick tunnel — no account needed
            # For localhost, returns http://localhost:8888 directly (no tunnel needed)
            tunnel_url = start_cloudflare_tunnel(8888, machine_ip=machine_ip)
            public_url = f"{tunnel_url}?token={token}"

            job_store[job_id] = {"status": "done", "public_url": public_url}
            print(f"[Agent] [{job_id}] Ready -> {public_url}")  # ASCII arrow, safe on Windows

            # Notify central backend of completion
            try:
                complete_url = BACKEND_URL.replace("/heartbeat", "/complete-job")
                requests.post(complete_url, json={"job_id": int(job_id), "status": "done", "jupyter_url": public_url}, timeout=5)
            except Exception as err:
                print(f"[Agent] Failed to report job completion: {err}")

        except Exception as e:
            job_store[job_id] = {"status": "error", "detail": str(e)}
            print(f"[Agent] [{job_id}] FAILED: {e}")
            try:
                complete_url = BACKEND_URL.replace("/heartbeat", "/complete-job")
                requests.post(complete_url, json={"job_id": int(job_id), "status": "error", "detail": str(e)}, timeout=5)
            except Exception:
                pass

    @flask_app.route("/run-jupyter", methods=["POST"])
    def run_jupyter():
        """
        Accepts a token, starts Docker + Cloudflare tunnel in background.
        Returns job_id immediately — caller should poll /job-status/<job_id>.
        Source: docker-py + cloudflare trycloudflare
        """
        data = flask_request.get_json()
        token = data.get("token", uuid.uuid4().hex)
        machine_ip = data.get("machine_ip", "127.0.0.1")
        job_id = uuid.uuid4().hex[:12]

        job_store[job_id] = {"status": "pending"}
        t = threading.Thread(target=_launch_jupyter_bg, args=(job_id, token, machine_ip), daemon=True)
        t.start()

        print(f"[Agent] Job {job_id} queued for token {token[:8]}…")
        return jsonify({"status": "pending", "job_id": job_id}), 202

    @flask_app.route("/job-status/<job_id>", methods=["GET"])
    def job_status(job_id):
        """Poll this endpoint until status == 'done' or 'error'."""
        job = job_store.get(job_id)
        if not job:
            return jsonify({"status": "not_found"}), 404
        return jsonify(job), 200

    @flask_app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", "machine_id": MACHINE_ID}), 200


if __name__ == "__main__":
    # Start heartbeat in background thread
    hb_thread = threading.Thread(target=heartbeat_loop, daemon=True)
    hb_thread.start()

    # Start Flask command server on port 9000
    if FLASK_AVAILABLE:
        print(f"[Agent] Command server listening on port 9000")
        flask_app.run(host="0.0.0.0", port=9000)
    else:
        print("[Agent] Flask not available. Install with: pip install flask docker")
        hb_thread.join()

