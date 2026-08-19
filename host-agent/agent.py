"""
Host Agent - GPU Share Hub
====================================
Phase 2 Features:
  - Interactive CLI onboarding with strict hardware validation
  - Persistent host_config.json for provider resource limits
  - Pre-pulls Docker image on startup (fast launch, ~20s instead of 10min)
  - Dynamic port allocation per job (supports multiple renters on same machine)
  - Resource caps per container (CPU, RAM enforced via Docker cgroups)
  - /shutdown endpoint for graceful host exit
"""

import time
import requests
import subprocess
import uuid
import os
import sys
import json
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

# Docker image — pre-baked image with PyTorch CUDA 12.1 + common ML libs
DOCKER_IMAGE = os.environ.get("DOCKER_IMAGE", "jupyter/scipy-notebook:latest")

# Generate or load a stable machine ID
BASE_DIR = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "."
MACHINE_ID_FILE = os.path.join(BASE_DIR, "machine_id.txt")
CONFIG_FILE = os.path.join(BASE_DIR, "host_config.json")

if os.path.exists(MACHINE_ID_FILE):
    with open(MACHINE_ID_FILE, 'r') as f:
        MACHINE_ID = f.read().strip()
else:
    MACHINE_ID = f"node-{uuid.uuid4().hex[:6]}"
    with open(MACHINE_ID_FILE, 'w') as f:
        f.write(MACHINE_ID)


# ---------------------------------------------------------------
# HARDWARE DETECTION & INTERACTIVE CLI ONBOARDING
# ---------------------------------------------------------------

def get_system_hardware():
    """Detect physical hardware capabilities (CPU, RAM, GPU VRAM)."""
    # 1. Total CPU cores
    total_cpus = os.cpu_count() or 4

    # 2. Total System RAM in GB
    total_ram_gb = 8.0
    try:
        if os.name == 'nt':
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ('dwLength', ctypes.c_ulong),
                    ('dwMemoryLoad', ctypes.c_ulong),
                    ('ullTotalPhys', ctypes.c_ulonglong),
                    ('ullAvailPhys', ctypes.c_ulonglong),
                    ('ullTotalPageFile', ctypes.c_ulonglong),
                    ('ullAvailPageFile', ctypes.c_ulonglong),
                    ('ullTotalVirtual', ctypes.c_ulonglong),
                    ('ullAvailVirtual', ctypes.c_ulonglong),
                    ('sullAvailExtendedVirtual', ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            total_ram_gb = round(stat.ullTotalPhys / (1024**3), 1)
        else:
            with open('/proc/meminfo', 'r') as f:
                for line in f:
                    if 'MemTotal' in line:
                        total_ram_gb = round(int(line.split()[1]) / (1024**2), 1)
                        break
    except Exception:
        total_ram_gb = 8.0

    # 3. GPU VRAM & Model Name
    gpu_name = "No NVIDIA GPU Detected (Mock Mode)"
    total_vram_gb = 8.0
    if GPU_AVAILABLE:
        try:
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode('utf-8')
            gpu_name = name
            total_vram_gb = round(info.total / (1024**3), 1)
            pynvml.nvmlShutdown()
        except Exception:
            pass

    return {
        "gpu_name": gpu_name,
        "total_vram_gb": total_vram_gb,
        "total_cpus": total_cpus,
        "total_ram_gb": total_ram_gb
    }


def console_input(prompt_text=""):
    """
    Read input directly from the console window.
    Works even when the script was piped (e.g. irm ... | iex or curl | bash).
    """
    sys.stdout.write(prompt_text)
    sys.stdout.flush()
    try:
        if sys.stdin.isatty():
            return sys.stdin.readline().strip()
        # Direct console input for piped shells
        if os.name == 'nt':
            with open('CONIN$', 'r') as con:
                return con.readline().strip()
        else:
            with open('/dev/tty', 'r') as con:
                return con.readline().strip()
    except Exception:
        return ""


def prompt_number(prompt_text, min_val, max_val, default_val, is_float=False):
    """
    Prompt user for a numeric value within [min_val, max_val].
    Strictly validates input; re-prompts on out-of-range or invalid values.
    """
    while True:
        try:
            val_str = console_input(f"{prompt_text} [Available: {max_val}, Default: {default_val}]: ")
            if not val_str:
                return default_val
            val = float(val_str) if is_float else int(val_str)
            if min_val <= val <= max_val:
                return val
            else:
                print(f"  ❌ Invalid range! Please enter a value between {min_val} and {max_val}.")
        except ValueError:
            print(f"  ❌ Invalid input! Please enter a numeric value between {min_val} and {max_val}.")


def load_or_prompt_config():
    """
    Load saved host limits or prompt provider via interactive CLI with validation.
    """
    hw = get_system_hardware()
    reconfigure = "--reconfigure" in sys.argv or "-r" in sys.argv
    non_interactive = "--yes" in sys.argv or "-y" in sys.argv or os.environ.get("HEADLESS") == "1"

    # Load existing config if available and not reconfiguring
    if os.path.exists(CONFIG_FILE) and not reconfigure:
        try:
            with open(CONFIG_FILE, 'r') as f:
                cfg = json.load(f)
                print("\n=======================================================")
                print("  GPU Share Hub — Saved Provider Configuration Loaded")
                print("=======================================================")
                print(f"  GPU Hardware : {hw['gpu_name']} (Total: {hw['total_vram_gb']} GB)")
                print(f"  Shared VRAM  : {cfg.get('shared_vram_gb', hw['total_vram_gb'])} GB")
                print(f"  Shared CPUs  : {cfg.get('shared_cpus', hw['total_cpus'])} cores")
                print(f"  Shared RAM   : {cfg.get('shared_ram_gb', hw['total_ram_gb'])} GB")
                print("  (Tip: Run with python gpu-agent.py --reconfigure to change)")
                print("=======================================================\n")
                return cfg
        except Exception:
            pass

    # Explicit headless mode
    if non_interactive and not reconfigure:
        cfg = {
            "shared_vram_gb": hw["total_vram_gb"],
            "shared_cpus": max(1, hw["total_cpus"] - 1),
            "shared_ram_gb": max(2.0, round(hw["total_ram_gb"] * 0.75, 1))
        }
        with open(CONFIG_FILE, 'w') as f:
            json.dump(cfg, f, indent=2)
        return cfg

    # Interactive CLI Prompting with strict validation
    print("\n" + "=" * 60)
    print("      GPU Share Hub — Provider Resource Configuration")
    print("=" * 60)
    print("Detected Hardware on your machine:")
    print(f"  • GPU Model : {hw['gpu_name']}")
    print(f"  • Total VRAM: {hw['total_vram_gb']} GB")
    print(f"  • Total CPUs: {hw['total_cpus']} Cores")
    print(f"  • Total RAM : {hw['total_ram_gb']} GB")
    print("-" * 60)
    print("Please choose how much of your resources you want to share.")
    print("(Press Enter to accept defaults. Renters cannot exceed these caps)\n")

    # 1. VRAM Prompt
    default_vram = hw["total_vram_gb"]
    min_vram = 0.5 if default_vram >= 1 else 0.1
    shared_vram = prompt_number(
        "→ Max VRAM to share (GB)",
        min_val=min_vram,
        max_val=hw["total_vram_gb"],
        default_val=default_vram,
        is_float=True
    )

    # 2. CPU Prompt
    default_cpu = max(1, hw["total_cpus"] - 2 if hw["total_cpus"] > 2 else hw["total_cpus"])
    shared_cpus = prompt_number(
        "→ Max CPU cores to share",
        min_val=1,
        max_val=hw["total_cpus"],
        default_val=default_cpu,
        is_float=False
    )

    # 3. System RAM Prompt
    default_ram = max(1.0, round(hw["total_ram_gb"] * 0.75, 1))
    shared_ram = prompt_number(
        "→ Max System RAM to share (GB)",
        min_val=1.0,
        max_val=hw["total_ram_gb"],
        default_val=default_ram,
        is_float=True
    )

    cfg = {
        "shared_vram_gb": shared_vram,
        "shared_cpus": shared_cpus,
        "shared_ram_gb": shared_ram
    }

    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)

    print("\n" + "=" * 60)
    print("✅ Configuration saved to host_config.json!")
    print(f"   Sharing Caps: {shared_vram} GB VRAM | {shared_cpus} CPUs | {shared_ram} GB RAM")
    print("=" * 60 + "\n")
    return cfg


# Initialize Provider Configuration
PROVIDER_CONFIG = load_or_prompt_config()


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
    """
    Return VRAM and CPU stats capped to the provider's configured limits.
    """
    max_shared_vram_mb = PROVIDER_CONFIG.get("shared_vram_gb", 8.0) * 1024
    max_shared_cpus = PROVIDER_CONFIG.get("shared_cpus", os.cpu_count() or 4)

    if not GPU_AVAILABLE:
        return {
            "vram_total_mb": max_shared_vram_mb,
            "vram_free_mb": max_shared_vram_mb,
            "cpus": max_shared_cpus,
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

        actual_free_mb = info.free / 1024**2
        # Cap advertised VRAM to provider's limit
        capped_free_mb = min(actual_free_mb, max_shared_vram_mb)

        return {
            "vram_total_mb": max_shared_vram_mb,
            "vram_free_mb": capped_free_mb,
            "cpus": max_shared_cpus,
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
                req_cpu = job.get("cpu_cores", 2)
                req_ram = job.get("ram_gb", 8)

                # Clamp to provider max limits
                cpu_cores = min(req_cpu, PROVIDER_CONFIG.get("shared_cpus", 4))
                ram_gb = min(req_ram, int(PROVIDER_CONFIG.get("shared_ram_gb", 8.0)))

                print(f"[Agent] Received new job #{j_id}! (Allocated: {cpu_cores} CPUs, {ram_gb}GB RAM) Starting Jupyter...")
                threading.Thread(
                    target=_launch_jupyter_bg,
                    args=(j_id, t_token, tailscale_ip, cpu_cores, ram_gb),
                    daemon=True
                ).start()

            vram_free = stats['vram_free_mb']
            gpu_util = stats.get('gpu_util_pct', 0)
            print(f"[{time.strftime('%X')}] Heartbeat 200 | Capped Free VRAM: {vram_free:.0f}MB | GPU util: {gpu_util}% | IP: {tailscale_ip}")
        else:
            print(f"[{time.strftime('%X')}] Heartbeat {resp.status_code}")
    except Exception as e:
        print(f"[{time.strftime('%X')}] Heartbeat FAILED: {e}")


def heartbeat_loop():
    """Background thread: send heartbeats every 3 seconds to quickly pick up jobs."""
    print(f"[Agent] Active Machine ID: {MACHINE_ID}")
    print(f"[Agent] Backend Target: {BACKEND_URL}")
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
            [cf_binary, "tunnel", "--url", f"http://127.0.0.1:{port}"],
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
        4. Wait for Jupyter HTTP server to be fully ready
        5. Create Cloudflare tunnel for public access
        """
        try:
            client = docker.from_env()

            # Dynamic port allocation: find a free port for this job
            host_port = find_free_port()
            container_name = f"jupyter-{token[:8]}"

            # Cleanup: remove any existing container with same name
            for c in client.containers.list(all=True):
                if c.name == container_name:
                    print(f"[Agent] Removing existing container: {c.name}")
                    try:
                        c.stop(timeout=3)
                        c.remove(force=True)
                    except Exception:
                        pass

            # GPU passthrough
            device_requests = []
            if GPU_AVAILABLE:
                device_requests = [docker.types.DeviceRequest(count=-1, capabilities=[['gpu']])]

            # Hard resource caps via Docker cgroups
            cpu_period = 100000
            cpu_quota = cpu_cores * cpu_period
            mem_limit = f"{ram_gb}g"

            print(f"[Agent] [{job_id}] Launching container on port {host_port} "
                  f"(Capped at: {cpu_cores} CPUs, {ram_gb}GB RAM, GPU: {'Yes' if GPU_AVAILABLE else 'No'})...")

            container = client.containers.run(
                DOCKER_IMAGE,
                detach=True,
                ports={"8888/tcp": host_port},
                cpu_period=cpu_period,
                cpu_quota=cpu_quota,
                mem_limit=mem_limit,
                memswap_limit=mem_limit,
                device_requests=device_requests,
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

            # Actively poll until Jupyter is ready and responding
            print(f"[Agent] [{job_id}] Waiting for Jupyter to be ready on 127.0.0.1:{host_port}...")
            is_ready = False
            for attempt in range(25):
                try:
                    r = requests.get(f"http://127.0.0.1:{host_port}/", timeout=1)
                    if r.status_code in [200, 302, 403]:
                        is_ready = True
                        print(f"[Agent] [{job_id}] Jupyter is alive and responding (HTTP {r.status_code})!")
                        break
                except Exception:
                    pass
                time.sleep(1)

            if not is_ready:
                print(f"[Agent] [{job_id}] Warning: Jupyter readiness check timed out, proceeding with tunnel...")

            # Start Cloudflare quick tunnel to dynamic port
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
        data = flask_request.get_json()
        token = data.get("token", uuid.uuid4().hex)
        machine_ip = data.get("machine_ip", "127.0.0.1")
        req_cpu = data.get("cpu_cores", 2)
        req_ram = data.get("ram_gb", 8)
        job_id = uuid.uuid4().hex[:12]

        cpu_cores = min(req_cpu, PROVIDER_CONFIG.get("shared_cpus", 4))
        ram_gb = min(req_ram, int(PROVIDER_CONFIG.get("shared_ram_gb", 8.0)))

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
        job = job_store.get(job_id)
        if not job:
            return jsonify({"status": "not_found"}), 404
        return jsonify(job), 200

    @flask_app.route("/health", methods=["GET"])
    def health():
        try:
            client = docker.from_env()
            active = [c.name for c in client.containers.list() if c.name.startswith("jupyter-")]
        except Exception:
            active = []
        return jsonify({
            "status": "ok",
            "machine_id": MACHINE_ID,
            "provider_config": PROVIDER_CONFIG,
            "active_containers": active,
            "active_jobs": len(active),
        }), 200

    @flask_app.route("/shutdown", methods=["POST"])
    def shutdown():
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
    # Pre-fetch Docker image in background
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
