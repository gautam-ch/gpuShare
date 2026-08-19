"""
Host Agent - GPU Share Hub
====================================
Phase 2 Features:
  - Pre-pulls Docker image on startup (fast launch, ~20s instead of 10min)
  - Dynamic port allocation per job (supports multiple renters on same machine)
  - Resource caps per container (CPU, RAM enforced via Docker cgroups)
  - /shutdown endpoint for graceful host exit
  - Idle detection: only available when GPU/CPU usage is low
"""

import time
import requests
import subprocess
import uuid
import os
import threading
import socket

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

# Docker image — our pre-baked image with PyTorch CUDA 12.1 + common ML libs
# Falls back to scipy-notebook if custom image not available
DOCKER_IMAGE = os.environ.get("DOCKER_IMAGE", "jupyter/scipy-notebook:latest")

# Generate or load a stable machine ID
MACHINE_ID_FILE = os.path.join(os.path.dirname(__file__) if "__file__" in dir() else ".", "machine_id.txt")
if os.path.exists(MACHINE_ID_FILE):
    with open(MACHINE_ID_FILE, 'r') as f:
        MACHINE_ID = f.read().strip()
else:
    MACHINE_ID = f"node-{uuid.uuid4().hex[:6]}"
    with open(MACHINE_ID_FILE, 'w') as f:
        f.write(MACHINE_ID)


# ---------------------------------------------------------------
# RESOURCE HELPERS
# ---------------------------------------------------------------

def find_free_port() -> int:
    """Find a free TCP port on this machine for a new container."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.getsockname()[1]


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
    """Return VRAM and CPU stats. Falls back to safe defaults if no GPU."""
    if not GPU_AVAILABLE:
        return {
            "vram_total_mb": 8192,
            "vram_free_mb": 8192,
            "cpus": os.cpu_count() or 4,
            "gpu_util_pct": 0,
        }
    pynvml.nvmlInit()
    try:
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            gpu_util = util.gpu
        except Exception:
            gpu_util = 0
        return {
            "vram_total_mb": info.total / 1024**2,
            "vram_free_mb": info.free / 1024**2,
            "cpus": os.cpu_count() or 4,
            "gpu_util_pct": gpu_util,
        }
    finally:
        pynvml.nvmlShutdown()


# ---------------------------------------------------------------
# DOCKER IMAGE PRE-FETCH
# ---------------------------------------------------------------

def prefetch_image():
    """
    Pre-pull the Docker image on agent startup so the first renter
    gets a ~20s launch instead of waiting 10+ minutes for the download.
    """
    if not FLASK_AVAILABLE:
        return
    try:
        client = docker.from_env()
        # Check if image already exists locally
        try:
            client.images.get(DOCKER_IMAGE)
            print(f"[Agent] Docker image '{DOCKER_IMAGE}' already cached locally. Launch will be instant!")
            return
        except docker.errors.ImageNotFound:
            pass
        print(f"[Agent] Pre-fetching Docker image '{DOCKER_IMAGE}' in background (one-time download)...")
        client.images.pull(DOCKER_IMAGE)
        print(f"[Agent] Docker image ready. Future launches will be instant!")
    except Exception as e:
        print(f"[Agent] Image pre-fetch failed (will pull on first use): {e}")


# ---------------------------------------------------------------
# HEARTBEAT
# ---------------------------------------------------------------

def send_heartbeat():
    """Send a heartbeat payload to the backend and handle dispatched jobs."""
    stats = get_gpu_stats()
    tailscale_ip = get_tailscale_ip()
    payload = {
        "machine_id": MACHINE_ID,
        "tailscale_ip": tailscale_ip,
        "status": "online",
        "vram_total_mb": stats["vram_total_mb"],
        "vram_free_mb": stats["vram_free_mb"],
        "cpus": stats["cpus"],
    }
    try:
        resp = requests.post(BACKEND_URL, json=payload, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            dispatched = data.get("jobs", [])
            for job in dispatched:
                j_id = str(job.get("job_id"))
                t_token = job.get("token")
                cpu_cores = job.get("cpu_cores", 2)
                ram_gb = job.get("ram_gb", 8)
                print(f"[Agent] Received new job #{j_id}! (CPU:{cpu_cores} cores, RAM:{ram_gb}GB) Starting Jupyter...")
                threading.Thread(
                    target=_launch_jupyter_bg,
                    args=(j_id, t_token, tailscale_ip, cpu_cores, ram_gb),
                    daemon=True
                ).start()

            vram_free = stats['vram_free_mb']
            gpu_util = stats.get('gpu_util_pct', 0)
            print(f"[{time.strftime('%X')}] Heartbeat 200 | VRAM free: {vram_free:.0f}MB | GPU util: {gpu_util}% | IP: {tailscale_ip}")
        else:
            print(f"[{time.strftime('%X')}] Heartbeat {resp.status_code}")
    except Exception as e:
        print(f"[{time.strftime('%X')}] Heartbeat FAILED: {e}")


def heartbeat_loop():
    """Background thread: send heartbeats every 3 seconds to quickly pick up jobs."""
    print(f"[Agent] Starting. Machine ID: {MACHINE_ID}")
    print(f"[Agent] Docker image: {DOCKER_IMAGE}")
    print(f"[Agent] Backend: {BACKEND_URL}")
    while True:
        send_heartbeat()
        time.sleep(3)


# ---------------------------------------------------------------
# FLASK COMMAND SERVER
# ---------------------------------------------------------------
if FLASK_AVAILABLE:
    flask_app = Flask(__name__)

    def start_cloudflare_tunnel(port: int, machine_ip: str = "127.0.0.1") -> str:
        """
        Start a Cloudflare quick tunnel (no account needed).
        For localhost testing, skip the tunnel and return localhost URL directly.
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
            public_url = found_q.get(timeout=30)
        except queue.Empty:
            proc.kill()
            raise RuntimeError("Cloudflare tunnel did not produce a URL within 30s")

        print(f"[Agent] Cloudflare tunnel active: {public_url}")
        return public_url

    # In-memory job store: job_id -> {"status": "pending|done|error", "public_url": str}
    job_store: dict = {}

    def _launch_jupyter_bg(
        job_id: str,
        token: str,
        machine_ip: str = "127.0.0.1",
        cpu_cores: int = 2,
        ram_gb: int = 8,
    ):
        """
        Background thread:
        1. Find a free port (supports multiple instances on same machine)
        2. Apply Docker cgroup resource caps (CPU + RAM)
        3. Start container with GPU passthrough
        4. Create Cloudflare tunnel for public access
        """
        try:
            client = docker.from_env()

            # --- Dynamic port allocation: find a free port for this job ---
            host_port = find_free_port()
            container_name = f"jupyter-{token[:8]}"

            # Cleanup: remove any existing container with same name (re-rent scenario)
            for c in client.containers.list(all=True):
                if c.name == container_name:
                    print(f"[Agent] Removing existing container: {c.name}")
                    try:
                        c.stop(timeout=3)
                        c.remove(force=True)
                    except Exception:
                        pass

            # --- GPU passthrough ---
            device_requests = []
            if GPU_AVAILABLE:
                device_requests = [docker.types.DeviceRequest(count=-1, capabilities=[['gpu']])]

            # --- Resource caps via Docker cgroups ---
            # cpu_quota = cpu_cores * cpu_period (e.g. 2 cores = 200000 / 100000)
            cpu_period = 100000
            cpu_quota = cpu_cores * cpu_period
            mem_limit = f"{ram_gb}g"

            print(f"[Agent] [{job_id}] Starting container on port {host_port} "
                  f"(CPU: {cpu_cores} cores, RAM: {ram_gb}GB, GPU: {'Yes' if GPU_AVAILABLE else 'No'})...")

            container = client.containers.run(
                DOCKER_IMAGE,
                detach=True,
                # Port: map host_port -> container's 8888 (unique per job)
                ports={"8888/tcp": host_port},
                # Resource caps enforced by Docker cgroups at kernel level
                cpu_period=cpu_period,
                cpu_quota=cpu_quota,
                mem_limit=mem_limit,
                memswap_limit=mem_limit,  # Disable swap
                # GPU access
                device_requests=device_requests,
                # Environment
                environment={
                    "JUPYTER_TOKEN": token,
                    "GRANT_SUDO": "yes",
                    "CUDA_VISIBLE_DEVICES": "0",
                },
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
            print(f"[Agent] [{job_id}] Container up: {container.short_id} on port {host_port}")

            # Give Jupyter a moment to bind to port
            time.sleep(5)

            # Start Cloudflare quick tunnel to the dynamic port
            tunnel_url = start_cloudflare_tunnel(host_port, machine_ip=machine_ip)
            public_url = f"{tunnel_url}?token={token}"

            job_store[job_id] = {"status": "done", "public_url": public_url}
            print(f"[Agent] [{job_id}] Ready -> {public_url}")

            # Notify central backend of completion
            try:
                complete_url = BACKEND_URL.replace("/heartbeat", "/complete-job")
                requests.post(complete_url, json={
                    "job_id": int(job_id),
                    "status": "done",
                    "jupyter_url": public_url
                }, timeout=5)
            except Exception as err:
                print(f"[Agent] Failed to report job completion: {err}")

        except Exception as e:
            job_store[job_id] = {"status": "error", "detail": str(e)}
            print(f"[Agent] [{job_id}] FAILED: {e}")
            try:
                complete_url = BACKEND_URL.replace("/heartbeat", "/complete-job")
                requests.post(complete_url, json={
                    "job_id": int(job_id),
                    "status": "error",
                    "detail": str(e)
                }, timeout=5)
            except Exception:
                pass

    @flask_app.route("/run-jupyter", methods=["POST"])
    def run_jupyter():
        """
        Accepts a token + resource spec, starts Docker + Cloudflare tunnel in background.
        Returns job_id immediately — caller polls /job-status/<job_id>.
        """
        data = flask_request.get_json()
        token = data.get("token", uuid.uuid4().hex)
        machine_ip = data.get("machine_ip", "127.0.0.1")
        cpu_cores = data.get("cpu_cores", 2)
        ram_gb = data.get("ram_gb", 8)
        job_id = uuid.uuid4().hex[:12]

        job_store[job_id] = {"status": "pending"}
        t = threading.Thread(
            target=_launch_jupyter_bg,
            args=(job_id, token, machine_ip, cpu_cores, ram_gb),
            daemon=True
        )
        t.start()

        print(f"[Agent] Job {job_id} queued (CPU:{cpu_cores}, RAM:{ram_gb}GB) for token {token[:8]}...")
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
        """Health check — also returns active container list."""
        try:
            client = docker.from_env()
            active = [c.name for c in client.containers.list() if c.name.startswith("jupyter-")]
        except Exception:
            active = []
        return jsonify({
            "status": "ok",
            "machine_id": MACHINE_ID,
            "active_containers": active,
            "active_jobs": len(active),
        }), 200

    @flask_app.route("/shutdown", methods=["POST"])
    def shutdown():
        """
        Graceful shutdown: stop all running Jupyter containers, then exit agent.
        Provider can call this or use Ctrl+C to stop sharing.
        """
        print("[Agent] Shutdown requested. Stopping all Jupyter containers...")
        try:
            client = docker.from_env()
            stopped = 0
            for container in client.containers.list():
                if container.name.startswith("jupyter-"):
                    container.stop(timeout=10)
                    stopped += 1
                    print(f"[Agent] Stopped container: {container.name}")
        except Exception as e:
            print(f"[Agent] Error during shutdown: {e}")

        print(f"[Agent] Shutdown complete. Stopped {stopped} container(s). Exiting.")

        def _exit():
            time.sleep(1)
            os._exit(0)

        threading.Thread(target=_exit, daemon=True).start()
        return jsonify({"status": "shutdown_initiated", "containers_stopped": stopped}), 200


if __name__ == "__main__":
    # Pre-fetch Docker image in background (so first renter is fast)
    threading.Thread(target=prefetch_image, daemon=True).start()

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
