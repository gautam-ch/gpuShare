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
    import logging
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False

# Generate or load a stable machine ID & .env configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else "."
ENV_FILE = os.path.join(BASE_DIR, ".env")
MACHINE_ID_FILE = os.path.join(BASE_DIR, "machine_id.txt")
CONFIG_FILE = os.path.join(BASE_DIR, "host_config.json")

# Automatically load .env file if present
if os.path.exists(ENV_FILE):
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as ef:
            for line in ef:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k:
                        # Overwrite if unset or set to local fallback
                        if k not in os.environ or "localhost" in os.environ[k] or "127.0.0.1" in os.environ[k]:
                            os.environ[k] = v
        print(f"[Agent] Loaded environment variables from {ENV_FILE}")
    except Exception as e:
        print(f"[Agent] Note: Failed to read .env file: {e}")

BACKEND_URL = os.environ.get("BACKEND_URL", "https://provider-app-silk.vercel.app/heartbeat")
if not BACKEND_URL.endswith("/heartbeat"):
    BACKEND_URL = BACKEND_URL.rstrip("/") + "/heartbeat"

# Docker image — official Jupyter PyTorch image with CUDA 12 + PyTorch + TorchVision pre-baked
DOCKER_IMAGE = os.environ.get("DOCKER_IMAGE", "quay.io/jupyter/pytorch-notebook:cuda12-python-3.11.8")

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


def get_current_provider_config():
    """
    Read the latest limits from host_config.json in real-time.
    Falls back to the initial PROVIDER_CONFIG if the file is unreadable.
    """
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return PROVIDER_CONFIG


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
    max_shared_vram_mb = get_current_provider_config().get("shared_vram_gb", 8.0) * 1024
    max_shared_cpus = get_current_provider_config().get("shared_cpus", os.cpu_count() or 4)

    if not GPU_AVAILABLE:
        return {
            "vram_total_mb": max_shared_vram_mb,
            "vram_used_mb": 0,
            "vram_free_mb": max_shared_vram_mb,
            "cpus": max_shared_cpus,
            "gpu_util_pct": 0,
            "temp_c": 45,
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

        try:
            temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
        except Exception:
            temp = 45

        actual_used_mb = round(info.used / 1024**2, 1)
        actual_free_mb = round(info.free / 1024**2, 1)
        capped_free_mb = min(actual_free_mb, max_shared_vram_mb)

        return {
            "vram_total_mb": max_shared_vram_mb,
            "vram_used_mb": actual_used_mb,
            "vram_free_mb": capped_free_mb,
            "cpus": max_shared_cpus,
            "gpu_util_pct": gpu_util,
            "temp_c": temp,
        }
    finally:
        pynvml.nvmlShutdown()


def get_container_metrics():
    """
    Query Docker API for real-time CPU & RAM utilization and NVML for VRAM.
    Returns a dict mapping container name to its usage details.
    """
    if not FLASK_AVAILABLE:
        return {}

    containers_telemetry = {}
    try:
        client = docker.from_env()
        containers = [c for c in client.containers.list() if c.name.startswith("jupyter-")]
    except Exception:
        return {}

    # Get GPU processes for mapping VRAM usage
    nvml_processes = []
    if GPU_AVAILABLE:
        try:
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            nvml_processes = pynvml.nvmlDeviceGetComputeRunningProcesses(handle)
        except Exception:
            pass
        finally:
            try:
                pynvml.nvmlShutdown()
            except Exception:
                pass

    for container in containers:
        try:
            # 1. Get RAM usage from container stats (non-blocking)
            stats = container.stats(stream=False)
            
            # RAM calculation
            mem_stats = stats.get("memory_stats", {})
            ram_bytes = mem_stats.get("usage", 0)
            ram_gb = round(ram_bytes / (1024**3), 2)
            
            # CPU calculation
            cpu_stats = stats.get("cpu_stats", {})
            precpu_stats = stats.get("precpu_stats", {})
            
            cpu_delta = cpu_stats.get("cpu_usage", {}).get("total_usage", 0) - precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
            system_delta = cpu_stats.get("system_cpu_usage", 0) - precpu_stats.get("system_cpu_usage", 0)
            
            cpu_cores_used = 0.0
            if system_delta > 0 and cpu_delta > 0:
                online_cpus = cpu_stats.get("online_cpus", len(cpu_stats.get("cpu_usage", {}).get("percpu_usage", [1])))
                cpu_cores_used = round((cpu_delta / system_delta) * online_cpus, 2)
            
            # Get host PIDs of processes in this container
            container_pids = []
            try:
                top_res = container.top()
                pid_idx = -1
                for idx, title in enumerate(top_res.get('Titles', [])):
                    if title.upper() == 'PID':
                        pid_idx = idx
                        break
                if pid_idx != -1:
                    for p_info in top_res.get('Processes', []):
                        container_pids.append(int(p_info[pid_idx]))
            except Exception:
                try:
                    container_pids.append(container.attrs['State']['Pid'])
                except Exception:
                    pass

            # 2. Get VRAM usage by mapping container's PIDs to NVML processes
            vram_mb = 0.0
            
            # Method A: Container-internal query (required for Windows / WSL2)
            try:
                exec_res = container.exec_run("nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits")
                if exec_res.exit_code == 0:
                    lines = exec_res.output.decode("utf-8").strip().split("\n")
                    for line in lines:
                        if line.strip() and "," in line:
                            parts = line.split(",")
                            try:
                                vram_mb += float(parts[1].strip())
                            except ValueError:
                                pass
            except Exception:
                pass
            
            # Method B: Host NVML mapping fallback
            if vram_mb == 0 and GPU_AVAILABLE and nvml_processes:
                vram_bytes = 0
                for proc in nvml_processes:
                    if proc.pid in container_pids:
                        vram_bytes += proc.usedGpuMemory
                vram_mb = round(vram_bytes / (1024**2), 1)

            # Method C: Custom telemetry file fallback (required for Windows / WSL2)
            if vram_mb == 0:
                try:
                    # List all telemetry files in the container
                    exec_ls = container.exec_run("sh -c 'ls -1 /tmp/gpushare_usage_*.json'")
                    if exec_ls.exit_code == 0:
                        lines = exec_ls.output.decode("utf-8").strip().split("\n")
                        for line in lines:
                            line = line.strip()
                            if not line or "*" in line:
                                continue
                            try:
                                filename = os.path.basename(line)
                                pid_str = filename.replace("gpushare_usage_", "").replace(".json", "")
                                c_pid = int(pid_str)
                            except ValueError:
                                continue
                            
                            # Check if the process is still running inside the container
                            check_alive = container.exec_run(f"kill -0 {c_pid}")
                            if check_alive.exit_code == 0:
                                exec_cat = container.exec_run(f"cat {line}")
                                if exec_cat.exit_code == 0:
                                    import json
                                    data = json.loads(exec_cat.output.decode("utf-8").strip())
                                    vram_mb += float(data.get("vram_mb", 0.0))
                            else:
                                # Clean up stale telemetry file
                                container.exec_run(f"rm {line}")
                except Exception:
                    pass
            
            containers_telemetry[container.name] = {
                "cpu_cores": cpu_cores_used,
                "ram_gb": ram_gb,
                "vram_mb": vram_mb
            }
        except Exception:
            containers_telemetry[container.name] = {
                "cpu_cores": 0.0,
                "ram_gb": 0.0,
                "vram_mb": 0.0
            }

    return containers_telemetry


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

# Active tunnel processes: token -> subprocess.Popen (one per concurrent pod)
active_tunnels: dict = {}
# In-memory job store: job_id -> {"status": "pending|done|error", "public_url": str}
job_store: dict = {}

def stop_and_cleanup_pod(token: str, job_id: str = ""):
    """
    Stop and remove the specific Jupyter container and kill its Cloudflare tunnel.
    Frees 100% of RAM, CPU, and VRAM back to the host machine.
    """
    container_prefix = token[:8] if token else ""
    print(f"[Agent] [Teardown] Terminating session #{job_id} for token '{container_prefix}'...")

    # 1. Terminate Cloudflare tunnel process
    for t_key in list(active_tunnels.keys()):
        if not container_prefix or container_prefix in t_key or t_key.startswith(container_prefix):
            try:
                active_tunnels[t_key].terminate()
                active_tunnels[t_key].kill()
                del active_tunnels[t_key]
                print(f"[Agent] [Teardown] Tunnel closed for token {t_key}")
            except Exception as e:
                print(f"[Agent] [Teardown] Error closing tunnel: {e}")

    # 2. Stop & Remove Docker Container
    try:
        client = docker.from_env()
        for c in client.containers.list(all=True):
            if c.name.startswith("jupyter-"):
                if not container_prefix or container_prefix in c.name or token in c.name:
                    try:
                        print(f"[Agent] [Teardown] Stopping container {c.name}...")
                        c.stop(timeout=5)
                        c.remove(force=True)
                        print(f"[Agent] [Teardown] Container '{c.name}' stopped and removed!")
                    except Exception as ce:
                        print(f"[Agent] [Teardown] Error stopping container: {ce}")
    except Exception as de:
        print(f"[Agent] [Teardown] Docker error: {de}")

    # 3. Clean local job store
    if job_id and job_id in job_store:
        job_store[job_id] = {"status": "stopped"}

    print(f"[Agent] [Teardown] Pod session terminated. Host hardware 100% freed!\n")


# ---------------------------------------------------------------
# HARDWARE OVERLOAD & THERMAL GUARD WATCHDOG
# ---------------------------------------------------------------
OVERLOAD_ALERTS: list = []

def overload_watchdog_loop():
    """
    Continuous background watchdog:
    - Protects host hardware against extreme thermal or system exhaustion.
    - Automatically stops containers if:
      1. GPU Temperature >= 88°C (Critical Thermal Limit)
      2. Host Physical RAM is pinned >= 96%
    """
    consecutive_ram_spikes = 0

    while True:
        try:
            time.sleep(3)
            # Check for active Jupyter containers
            try:
                client = docker.from_env()
                running_containers = [c for c in client.containers.list() if c.name.startswith("jupyter-")]
            except Exception:
                running_containers = []

            if not running_containers:
                consecutive_ram_spikes = 0
                continue

            # Get GPU processes for VRAM monitoring
            nvml_processes = []
            if GPU_AVAILABLE:
                try:
                    pynvml.nvmlInit()
                    handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                    nvml_processes = pynvml.nvmlDeviceGetComputeRunningProcesses(handle)
                except Exception:
                    pass
                finally:
                    try:
                        pynvml.nvmlShutdown()
                    except Exception:
                        pass

            # A. CONTAINER-LEVEL ENFORCEMENT WATCHDOG
            for container in running_containers:
                # 1. Parse limits from environment variables
                env_vars = container.attrs.get("Config", {}).get("Env", [])
                vram_cap_gb = None
                cpu_cap_cores = None
                ram_cap_gb = None
                for env in env_vars:
                    if env.startswith("GPUSHARE_VRAM_GB="):
                        try:
                            vram_cap_gb = float(env.split("=")[1])
                        except ValueError:
                            pass
                    elif env.startswith("GPUSHARE_CPU_CORES="):
                        try:
                            cpu_cap_cores = float(env.split("=")[1])
                        except ValueError:
                            pass
                    elif env.startswith("GPUSHARE_RAM_GB="):
                        try:
                            ram_cap_gb = float(env.split("=")[1])
                        except ValueError:
                            pass

                # Get host PIDs of processes in this container
                container_pids = []
                try:
                    top_res = container.top()
                    pid_idx = -1
                    for idx, title in enumerate(top_res.get('Titles', [])):
                        if title.upper() == 'PID':
                            pid_idx = idx
                            break
                    if pid_idx != -1:
                        for p_info in top_res.get('Processes', []):
                            container_pids.append(int(p_info[pid_idx]))
                except Exception:
                    try:
                        container_pids.append(container.attrs['State']['Pid'])
                    except Exception:
                        pass

                if not container_pids:
                    continue

                # Query process statistics using psutil
                import psutil
                proc_details = []
                for pid in container_pids:
                    try:
                        proc = psutil.Process(pid)
                        mem_bytes = proc.memory_info().rss
                        cpu_pct = proc.cpu_percent(interval=None)
                        proc_details.append({
                            "pid": pid,
                            "proc": proc,
                            "mem_bytes": mem_bytes,
                            "cpu_pct": cpu_pct
                        })
                    except Exception:
                        pass

                # 2. RAM Limit Check
                container_ram_bytes = sum(p["mem_bytes"] for p in proc_details)
                container_ram_gb = container_ram_bytes / (1024**3)
                if ram_cap_gb is not None and container_ram_gb > ram_cap_gb:
                    alert_text = (
                        f"[Limit Guard] 🚨 Renter container '{container.name}' exceeded RAM limit! "
                        f"({container_ram_gb:.2f} GB > {ram_cap_gb:.2f} GB Cap). "
                        "Terminating the offending memory-consuming process in kernel..."
                    )
                    print("\n" + "=" * 60)
                    print(alert_text)
                    print("=" * 60 + "\n")
                    OVERLOAD_ALERTS.append({
                        "time": time.time(),
                        "reason": f"RAM Cap Exceeded on {container.name}",
                        "message": alert_text
                    })
                    proc_details.sort(key=lambda x: x["mem_bytes"], reverse=True)
                    if proc_details:
                        pid_to_kill = proc_details[0]["pid"]
                        try:
                            print(f"[Limit Guard] Sending SIGKILL to host process PID {pid_to_kill} (RAM: {proc_details[0]['mem_bytes']/(1024**2):.1f} MB)")
                            os.kill(pid_to_kill, 9)
                        except Exception as e:
                            print(f"[Limit Guard] Failed to kill PID {pid_to_kill}: {e}")

                # 3. CPU Cores Limit Check
                container_cpu_cores = sum(p["cpu_pct"] for p in proc_details) / 100.0
                if cpu_cap_cores is not None and container_cpu_cores > cpu_cap_cores:
                    global container_cpu_spikes
                    if 'container_cpu_spikes' not in globals():
                        container_cpu_spikes = {}
                    
                    container_cpu_spikes[container.name] = container_cpu_spikes.get(container.name, 0) + 1
                    if container_cpu_spikes[container.name] >= 3:
                        alert_text = (
                            f"[Limit Guard] 🚨 Renter container '{container.name}' exceeded CPU cores limit! "
                            f"({container_cpu_cores:.2f} Cores > {cpu_cap_cores:.2f} Cores Cap for 3 consecutive checks). "
                            "Terminating the offending CPU-consuming process in kernel..."
                        )
                        print("\n" + "=" * 60)
                        print(alert_text)
                        print("=" * 60 + "\n")
                        OVERLOAD_ALERTS.append({
                            "time": time.time(),
                            "reason": f"CPU Cap Exceeded on {container.name}",
                            "message": alert_text
                        })
                        proc_details.sort(key=lambda x: x["cpu_pct"], reverse=True)
                        if proc_details:
                            pid_to_kill = proc_details[0]["pid"]
                            try:
                                print(f"[Limit Guard] Sending SIGKILL to host process PID {pid_to_kill} (CPU: {proc_details[0]['cpu_pct']:.1f}%)")
                                os.kill(pid_to_kill, 9)
                            except Exception as e:
                                print(f"[Limit Guard] Failed to kill PID {pid_to_kill}: {e}")
                        container_cpu_spikes[container.name] = 0
                else:
                    if 'container_cpu_spikes' in globals() and container.name in container_cpu_spikes:
                        container_cpu_spikes[container.name] = 0

                # 4. VRAM Limit Check
                if vram_cap_gb is not None:
                    container_gpu_procs = []
                    container_vram_mb = 0

                    # Method A: Container-internal query (required for Windows / WSL2)
                    try:
                        exec_res = container.exec_run("nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits")
                        if exec_res.exit_code == 0:
                            lines = exec_res.output.decode("utf-8").strip().split("\n")
                            for line in lines:
                                if line.strip() and "," in line:
                                    parts = line.split(",")
                                    p_pid = int(parts[0].strip())
                                    try:
                                        p_vram = float(parts[1].strip())
                                    except ValueError:
                                        p_vram = 0.0
                                    container_vram_mb += p_vram
                                    container_gpu_procs.append((p_pid, p_vram, "internal"))
                    except Exception:
                        pass

                    # Method B: Host NVML mapping fallback (if internal query failed)
                    if container_vram_mb == 0 and GPU_AVAILABLE and nvml_processes:
                        for proc in nvml_processes:
                            if proc.pid in container_pids:
                                val_mb = proc.usedGpuMemory / (1024**2)
                                container_vram_mb += val_mb
                                container_gpu_procs.append((proc.pid, val_mb, "host"))

                    # Method C: Custom telemetry file fallback (required for Windows / WSL2)
                    if container_vram_mb == 0:
                        try:
                            # List all telemetry files in the container
                            exec_ls = container.exec_run("sh -c 'ls -1 /tmp/gpushare_usage_*.json'")
                            if exec_ls.exit_code == 0:
                                lines = exec_ls.output.decode("utf-8").strip().split("\n")
                                for line in lines:
                                    line = line.strip()
                                    if not line or "*" in line:
                                        continue
                                    try:
                                        filename = os.path.basename(line)
                                        pid_str = filename.replace("gpushare_usage_", "").replace(".json", "")
                                        c_pid = int(pid_str)
                                    except ValueError:
                                        continue
                                    
                                    # Check if the process is still running inside the container
                                    check_alive = container.exec_run(f"kill -0 {c_pid}")
                                    if check_alive.exit_code == 0:
                                        exec_cat = container.exec_run(f"cat {line}")
                                        if exec_cat.exit_code == 0:
                                            import json
                                            data = json.loads(exec_cat.output.decode("utf-8").strip())
                                            val_mb = float(data.get("vram_mb", 0.0))
                                            container_vram_mb += val_mb
                                            container_gpu_procs.append((c_pid, val_mb, "internal_telemetry"))
                                    else:
                                        # Clean up stale telemetry file
                                        container.exec_run(f"rm {line}")
                        except Exception:
                            pass

                    if container_vram_mb > vram_cap_gb * 1024:
                        alert_text = (
                            f"[Limit Guard] 🚨 Renter container '{container.name}' exceeded VRAM limit! "
                            f"({container_vram_mb:.1f} MB > {vram_cap_gb * 1024:.1f} MB Cap). "
                            "Terminating the offending GPU-consuming process..."
                        )
                        print("\n" + "=" * 60)
                        print(alert_text)
                        print("=" * 60 + "\n")
                        OVERLOAD_ALERTS.append({
                            "time": time.time(),
                            "reason": f"VRAM Cap Exceeded on {container.name}",
                            "message": alert_text
                        })
                        
                        container_gpu_procs.sort(key=lambda x: x[1], reverse=True)
                        if container_gpu_procs:
                            pid_to_kill, used_mem, pid_type = container_gpu_procs[0]
                            if pid_type in ("internal", "internal_telemetry"):
                                try:
                                    print(f"[Limit Guard] Terminating internal container PID {pid_to_kill} (VRAM: {used_mem:.1f} MB)")
                                    container.exec_run(f"kill -9 {pid_to_kill}")
                                except Exception as e:
                                    print(f"[Limit Guard] Failed to kill internal PID {pid_to_kill}: {e}")
                            else:
                                try:
                                    print(f"[Limit Guard] Sending SIGKILL to host process PID {pid_to_kill} (VRAM: {used_mem:.1f} MB)")
                                    os.kill(pid_to_kill, 9)
                                except Exception as e:
                                    print(f"[Limit Guard] Failed to kill host PID {pid_to_kill}: {e}")

            # B. HOST-LEVEL HARDWARE OVERLOAD GUARDS
            # 1. Thermal Check
            stats = get_gpu_stats()
            gpu_temp = stats.get("temp_c", 0)

            # 2. Host RAM Check
            ram_pct = 50
            try:
                import psutil
                ram_pct = psutil.virtual_memory().percent
            except Exception:
                pass

            critical_reason = None
            if gpu_temp >= 88:
                critical_reason = f"CRITICAL GPU TEMPERATURE ({gpu_temp}°C >= 88°C safety threshold)"
            elif ram_pct >= 96:
                consecutive_ram_spikes += 1
                if consecutive_ram_spikes >= 3:
                    critical_reason = f"CRITICAL SYSTEM RAM SATURATION ({ram_pct}% host memory used)"
            else:
                consecutive_ram_spikes = 0

            if critical_reason:
                alert_text = f"[Overload Guard] 🚨 {critical_reason}! Auto-stopping worker containers to protect hardware..."
                print("\n" + "=" * 60)
                print(alert_text)
                print("=" * 60 + "\n")
                OVERLOAD_ALERTS.append({"time": time.time(), "reason": critical_reason, "message": alert_text})

                for c in running_containers:
                    try:
                        print(f"[Overload Guard] Halting container: {c.name}...")
                        c.stop(timeout=5)
                        c.remove(force=True)
                    except Exception as ce:
                        print(f"[Overload Guard] Stop error for {c.name}: {ce}")

                # Terminate active Cloudflare tunnels
                for t_key in list(active_tunnels.keys()):
                    try:
                        active_tunnels[t_key].terminate()
                        active_tunnels[t_key].kill()
                        del active_tunnels[t_key]
                    except Exception:
                        pass

                consecutive_ram_spikes = 0

        except Exception as watchdog_err:
            time.sleep(5)


def send_heartbeat():
    """Send a heartbeat payload to the backend and handle dispatched/stopped jobs."""
    stats = get_gpu_stats()
    tailscale_ip = get_tailscale_ip()
    config = get_current_provider_config()
    payload = {
        "machine_id": MACHINE_ID,
        "tailscale_ip": tailscale_ip,
        "status": "online",
        "vram_total_mb": stats["vram_total_mb"],
        "vram_free_mb": stats["vram_free_mb"],
        "cpus": stats["cpus"],
        "shared_ram_gb": float(config.get("shared_ram_gb", 8.0)),
    }
    try:
        resp = requests.post(BACKEND_URL, json=payload, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            
            # 1. Handle NEW PENDING jobs
            dispatched = data.get("jobs", [])
            for job in dispatched:
                j_id = str(job.get("job_id"))
                t_token = job.get("token")
                req_cpu = job.get("cpu_cores", 2)
                req_ram = job.get("ram_gb", 8)
                req_vram = float(job.get("vram_gb", 2.0))

                # Clamp to provider max limits
                cpu_cores = min(req_cpu, config.get("shared_cpus", 4))
                ram_gb = min(req_ram, int(config.get("shared_ram_gb", 8.0)))
                vram_gb = min(req_vram, float(config.get("shared_vram_gb", 4.0)))

                print(f"[Agent] Received new job #{j_id}! (Allocated: {vram_gb:.1f}GB VRAM, {cpu_cores} CPUs, {ram_gb}GB RAM) Starting Jupyter...")
                threading.Thread(
                    target=_launch_jupyter_bg,
                    args=(j_id, t_token, tailscale_ip, cpu_cores, ram_gb, vram_gb),
                    daemon=True
                ).start()

            # 2. Handle STOPPED jobs (user ended session)
            stop_jobs = data.get("stop_jobs", [])
            for s_job in stop_jobs:
                s_id = str(s_job.get("job_id", ""))
                s_token = s_job.get("token", "")
                if s_token:
                    threading.Thread(
                        target=stop_and_cleanup_pod,
                        args=(s_token, s_id),
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

    @flask_app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        return response

    def start_cloudflare_tunnel(port: int, token: str = "", machine_ip: str = "127.0.0.1") -> str:
        """
        Start an independent Cloudflare quick tunnel for this specific pod.
        Tracks each tunnel process per token so multiple pods run simultaneously without killing each other.
        """
        import platform, re, queue, threading as _th

        # If re-renting the exact same token, close its old tunnel
        if token and token in active_tunnels:
            try:
                active_tunnels[token].terminate()
            except Exception:
                pass

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
        active_tunnels[token] = proc

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

        print(f"[Agent] Cloudflare tunnel active on port {port}: {public_url}")
        return public_url

    def _start_cloudflare_with_retry(port: int, token: str = "", machine_ip: str = "127.0.0.1", max_attempts: int = 3) -> str:
        """
        BUG-10: Wrap cloudflare tunnel startup with retry logic.
        Retries up to max_attempts times with 5s backoff before giving up.
        """
        last_err = None
        for attempt in range(1, max_attempts + 1):
            try:
                url = start_cloudflare_tunnel(port, token=token, machine_ip=machine_ip)
                return url
            except Exception as e:
                last_err = e
                print(f"[Agent] Cloudflare tunnel attempt {attempt}/{max_attempts} failed: {e}")
                if attempt < max_attempts:
                    time.sleep(5)
        raise RuntimeError(f"Cloudflare tunnel failed after {max_attempts} attempts: {last_err}")

    # In-memory job store: job_id -> {"status": "pending|done|error", "public_url": str}
    job_store: dict = {}

    def _get_target_image(client):
        """
        Pick the official pre-baked GPU PyTorch image on this machine.
        If not cached locally, pull it from the registry so PyTorch is 100% guaranteed.
        """
        preferred_order = [
            "quay.io/jupyter/pytorch-notebook:cuda12-python-3.11.8",
            "quay.io/jupyter/pytorch-notebook:latest",
            "gpu-jupyter:latest",
            DOCKER_IMAGE,
        ]
        for img in preferred_order:
            try:
                client.images.get(img)
                print(f"[Agent] Using cached PyTorch image: {img}")
                return img
            except Exception:
                pass
        
        target = "quay.io/jupyter/pytorch-notebook:cuda12-python-3.11.8"
        print(f"[Agent] PyTorch image not cached. Pulling official GPU image: {target}...")
        try:
            client.images.pull(target)
            print(f"[Agent] Successfully pulled {target}!")
            return target
        except Exception as e:
            print(f"[Agent] Warning: Failed to pull {target} ({e}), falling back to {DOCKER_IMAGE}")
            return DOCKER_IMAGE

    def _launch_jupyter_bg(
        job_id: str,
        token: str,
        machine_ip: str = "127.0.0.1",
        cpu_cores: int = 2,
        ram_gb: int = 8,
        vram_gb: float = 2.0,
    ):
        """
        Background thread:
        1. Find a free port (supports multiple instances simultaneously)
        2. Apply Docker cgroup resource caps (CPU + RAM) & cpuset CPU masking
        3. Inject auto-locking VRAM fraction script for PyTorch
        4. Start container with GPU passthrough & security sandboxing
        5. Wait for Jupyter HTTP server to be fully ready
        6. Create dedicated Cloudflare tunnel for this specific pod
        """
        try:
            client = docker.from_env()

            # Dynamic port allocation (unique per pod)
            host_port = find_free_port()
            container_name = f"jupyter-{token[:8]}"
            image_to_use = _get_target_image(client)

            # Cleanup ONLY if exact same container name already exists (re-rent scenario)
            for c in client.containers.list(all=True):
                if c.name == container_name:
                    print(f"[Agent] Replacing existing container with same token: {c.name}")
                    try:
                        c.stop(timeout=2)
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

            # CPU Core masking: restricts process to specific CPU cores so os.cpu_count() matches allocation
            total_host_cpus = os.cpu_count() or 4
            cpuset_cpus = f"0-{cpu_cores - 1}" if cpu_cores < total_host_cpus else None

            # Calculate VRAM fraction (e.g. 2.0 / 4.0 = 0.50)
            hw = get_system_hardware()
            total_vram_gb = max(0.5, float(hw.get("total_vram_gb", 4.0)))
            vram_fraction = min(1.0, max(0.05, vram_gb / total_vram_gb))

            # Dynamically write sitecustomize.py for VRAM cap enforcement and telemetry inside the container
            host_mount_dir = os.path.abspath(os.path.join(BASE_DIR, "gpushare_mount"))
            os.makedirs(host_mount_dir, exist_ok=True)
            sitecustomize_path = os.path.join(host_mount_dir, "sitecustomize.py")
            sitecustomize_content = """# sitecustomize.py
import sys
import os
import threading
import time

# Chain-load any pre-existing sitecustomize.py
our_dir = os.path.dirname(__file__)
original_sys_path = list(sys.path)
if our_dir in sys.path:
    sys.path.remove(our_dir)
try:
    import sitecustomize
except ImportError:
    pass
finally:
    sys.path = original_sys_path

def configure_gpu_limits():
    vram_cap_gb_str = os.getenv("GPUSHARE_VRAM_GB")
    if not vram_cap_gb_str:
        return
    try:
        vram_cap_gb = float(vram_cap_gb_str)
    except ValueError:
        return

    def watch_imports():
        torch_configured = False
        tf_configured = False
        limit_bytes = vram_cap_gb * 1024 * 1024 * 1024
        
        # Initial telemetry file creation
        try:
            with open(f"/tmp/gpushare_usage_{os.getpid()}.json", "w") as f:
                import json
                json.dump({
                    "vram_mb": 0.0,
                    "pid": os.getpid()
                }, f)
        except Exception:
            pass

        while True:
            # Monitor PyTorch
            if 'torch' in sys.modules:
                try:
                    import torch
                    if torch.cuda.is_available():
                        if not torch_configured:
                            total_mem = torch.cuda.get_device_properties(0).total_memory
                            fraction = min(1.0, limit_bytes / total_mem)
                            torch.cuda.set_per_process_memory_fraction(fraction, 0)
                            torch_configured = True
                        
                        # Active monitoring fallback
                        allocated = torch.cuda.memory_allocated(0)
                        if allocated > limit_bytes:
                            print(f"\\n[Limit Guard] 🚨 Process exceeded GPU VRAM limit! ({allocated / 1024**3:.2f} GB > {vram_cap_gb} GB Cap)", file=sys.stderr)
                            print("[Limit Guard] Terminating process...", file=sys.stderr)
                            os._exit(9)
                except Exception:
                    pass

            # Monitor TensorFlow
            if not tf_configured and 'tensorflow' in sys.modules:
                try:
                    import tensorflow as tf
                    gpus = tf.config.list_physical_devices('GPU')
                    if gpus:
                        vram_cap_mb = int(vram_cap_gb * 1024)
                        tf.config.set_logical_device_configuration(
                            gpus[0],
                            [tf.config.LogicalDeviceConfiguration(memory_limit=vram_cap_mb)]
                        )
                    tf_configured = True
                except Exception:
                    pass

            # Write telemetry file to /tmp/gpushare_usage_{pid}.json
            if 'torch' in sys.modules:
                try:
                    import torch
                    if torch.cuda.is_available():
                        allocated = torch.cuda.memory_allocated(0)
                        with open(f"/tmp/gpushare_usage_{os.getpid()}.json", "w") as f:
                            import json
                            json.dump({
                                "vram_mb": allocated / (1024**2),
                                "pid": os.getpid()
                            }, f)
                except Exception:
                    pass

            time.sleep(0.5)

    t = threading.Thread(target=watch_imports, daemon=True)
    t.start()

try:
    configure_gpu_limits()
except Exception:
    pass
"""
            with open(sitecustomize_path, "w", encoding="utf-8") as f:
                f.write(sitecustomize_content)

            print(f"[Agent] [{job_id}] Launching sandbox pod '{container_name}' on port {host_port} "
                  f"(Caps: {vram_gb:.1f}GB VRAM, {cpu_cores} CPUs, {ram_gb}GB RAM, GPU: {'Yes' if GPU_AVAILABLE else 'No'})...")

            # Clean native command line for reliable kernel startup
            if "gpu-jupyter" in image_to_use:
                cmd = [
                    "python3", "-m", "notebook",
                    "--ip=0.0.0.0",
                    "--port=8888",
                    "--no-browser",
                    f"--NotebookApp.token={token}",
                    "--NotebookApp.allow_origin=*",
                    "--NotebookApp.allow_remote_access=True",
                    "--NotebookApp.disable_check_xsrf=True",
                    "--NotebookApp.tornado_settings={\"headers\":{\"Content-Security-Policy\":\"frame-ancestors *\"}}",
                ]
            else:
                cmd = [
                    "start-notebook.sh",
                    f"--NotebookApp.token={token}",
                    "--NotebookApp.allow_origin=*",
                    "--NotebookApp.allow_remote_access=True",
                    "--NotebookApp.tornado_settings={\"headers\":{\"Content-Security-Policy\":\"frame-ancestors *\"}}",
                    "--NotebookApp.disable_check_xsrf=True",
                ]

            run_kwargs = {
                "image": image_to_use,
                "detach": True,
                "ports": {"8888/tcp": host_port},
                "cpu_period": cpu_period,
                "cpu_quota": cpu_quota,
                "mem_limit": mem_limit,
                "memswap_limit": mem_limit,
                "device_requests": device_requests,
                "environment": {
                    "JUPYTER_TOKEN": token,
                    "GRANT_SUDO": "no",
                    "CUDA_VISIBLE_DEVICES": "0",
                    "GPUSHARE_VRAM_GB": str(vram_gb),
                    "GPUSHARE_CPU_CORES": str(cpu_cores),
                    "GPUSHARE_RAM_GB": str(ram_gb),
                    "OMP_NUM_THREADS": str(cpu_cores),
                    "MKL_NUM_THREADS": str(cpu_cores),
                    "PYTHONPATH": "/etc/gpushare"
                },
                "volumes": {
                    host_mount_dir: {
                        "bind": "/etc/gpushare",
                        "mode": "ro"
                    }
                },
                "security_opt": ["no-new-privileges:true"],
                "remove": True,
                "name": container_name,
                "command": cmd
            }
            if cpuset_cpus:
                run_kwargs["cpuset_cpus"] = cpuset_cpus

            container = client.containers.run(**run_kwargs)
            print(f"[Agent] [{job_id}] Pod online: {container.short_id} on port {host_port}")

            # Actively poll until this pod's Jupyter is ready
            print(f"[Agent] [{job_id}] Waiting for pod on 127.0.0.1:{host_port}...")
            is_ready = False
            for attempt in range(30):
                try:
                    r = requests.get(f"http://127.0.0.1:{host_port}/", timeout=1)
                    if r.status_code in [200, 302, 403]:
                        is_ready = True
                        print(f"[Agent] [{job_id}] Pod is ready on port {host_port} (HTTP {r.status_code})!")
                        break
                except Exception:
                    pass
                time.sleep(1)

            if not is_ready:
                print(f"[Agent] [{job_id}] Warning: Jupyter HTTP ping timed out, starting tunnel anyway...")

            # Start dedicated Cloudflare quick tunnel with retry (BUG-10)
            tunnel_url = _start_cloudflare_with_retry(host_port, token=token, machine_ip=machine_ip)
            public_url = f"{tunnel_url}?token={token}"

            # BUG-09: Report 'running' immediately once tunnel URL is live
            try:
                complete_url = BACKEND_URL.replace("/heartbeat", "/complete-job")
                requests.post(complete_url, json={
                    "job_id": int(job_id),
                    "status": "running",
                    "jupyter_url": public_url
                }, timeout=5)
                print(f"[Agent] [{job_id}] Reported 'running' to backend")
            except Exception as err:
                print(f"[Agent] Failed to report running status: {err}")

            job_store[job_id] = {"status": "done", "public_url": public_url}
            print(f"[Agent] [{job_id}] Pod ready -> {public_url}")

            # Report 'done' as final confirmed state
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
        req_vram = data.get("vram_gb", 2.0)
        job_id = uuid.uuid4().hex[:12]

        config = get_current_provider_config()

        cpu_cores = min(req_cpu, config.get("shared_cpus", 4))
        ram_gb = min(req_ram, int(config.get("shared_ram_gb", 8.0)))
        vram_gb = min(req_vram, float(config.get("shared_vram_gb", 4.0)))

        job_store[job_id] = {"status": "pending"}
        t = threading.Thread(
            target=_launch_jupyter_bg,
            args=(job_id, token, machine_ip, cpu_cores, ram_gb, vram_gb),
            daemon=True
        )
        t.start()

        print(f"[Agent] Job {job_id} queued (VRAM:{vram_gb}GB, CPU:{cpu_cores}, RAM:{ram_gb}GB) for token {token[:8]}...")
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

        stats = get_gpu_stats()
        hw = get_system_hardware()

        # Get container-level telemetry
        containers_telemetry = get_container_metrics()

        # Sum of client consumption
        client_used_vram_mb = sum(c.get("vram_mb", 0) for c in containers_telemetry.values())
        client_used_cores = sum(c.get("cpu_cores", 0) for c in containers_telemetry.values())
        client_used_gb = sum(c.get("ram_gb", 0) for c in containers_telemetry.values())

        gpu_telemetry = {
            "model": hw.get("gpu_name", "NVIDIA Graphics Processor"),
            "total_vram_mb": round(hw.get("total_vram_gb", 4.0) * 1024),
            "used_vram_mb": stats.get("vram_used_mb", 0),
            "free_vram_mb": stats.get("vram_free_mb", 4096),
            "gpu_util_pct": stats.get("gpu_util_pct", 0),
            "temp_c": stats.get("temp_c", 45),
            "has_nvidia": GPU_AVAILABLE,
            "client_used_vram_mb": client_used_vram_mb
        }

        # CPU and System RAM live measurements
        total_cpus = os.cpu_count() or 12
        total_ram_gb = hw.get("total_ram_gb", 15.4)
        used_ram_gb = 6.4
        ram_used_pct = 42
        cpu_load_pct = 24

        if os.name == 'nt':
            try:
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
                used_ram_gb = round((stat.ullTotalPhys - stat.ullAvailPhys) / (1024**3), 1)
                ram_used_pct = int(stat.dwMemoryLoad)
            except Exception:
                pass

        try:
            import psutil
            cpu_load_pct = round(psutil.cpu_percent(interval=None))
            mem = psutil.virtual_memory()
            used_ram_gb = round(mem.used / (1024**3), 1)
            total_ram_gb = round(mem.total / (1024**3), 1)
            ram_used_pct = round(mem.percent)
        except Exception:
            pass

        cpu_telemetry = {
            "cores": total_cpus,
            "physicalCores": total_cpus,
            "brand": hw.get("cpu_brand", "AMD Ryzen 5 4600H (12 Cores)"),
            "loadPct": cpu_load_pct,
            "client_used_cores": client_used_cores
        }

        ram_telemetry = {
            "totalGb": total_ram_gb,
            "usedGb": used_ram_gb,
            "freeGb": max(0.1, round(total_ram_gb - used_ram_gb, 1)),
            "usedPct": ram_used_pct,
            "client_used_gb": client_used_gb
        }

        return jsonify({
            "status": "ok",
            "machine_id": MACHINE_ID,
            "provider_config": get_current_provider_config(),
            "active_containers": active,
            "active_jobs": len(active),
            "gpu": gpu_telemetry,
            "cpu": cpu_telemetry,
            "ram": ram_telemetry,
            "active_containers_telemetry": containers_telemetry,
            "overload_alerts": OVERLOAD_ALERTS[-5:],
        }), 200

    @flask_app.route("/container-logs", methods=["GET"])
    def container_logs():
        """Stream real-time Docker container stdout/stderr logs and runtime details."""
        try:
            client = docker.from_env()
            containers = [c for c in client.containers.list() if c.name.startswith("jupyter-")]
            logs_by_container = {}
            detailed_containers = []

            for c in containers:
                try:
                    raw_logs = c.logs(tail=80).decode("utf-8", errors="replace")
                    logs_by_container[c.name] = [l for l in raw_logs.split("\n") if l.strip()]
                except Exception:
                    logs_by_container[c.name] = []

                ports = c.attrs.get("NetworkSettings", {}).get("Ports", {})
                host_port = "8888"
                if "8888/tcp" in ports and ports["8888/tcp"]:
                    host_port = ports["8888/tcp"][0].get("HostPort", "8888")

                detailed_containers.append({
                    "name": c.name,
                    "id": c.short_id,
                    "image": c.image.tags[0] if c.image.tags else "quay.io/jupyter/pytorch-notebook",
                    "status": c.status,
                    "port": host_port,
                    "created": c.attrs.get("Created", "")
                })

            return jsonify({
                "containers": detailed_containers,
                "logs": logs_by_container
            }), 200
        except Exception as e:
            return jsonify({"containers": [], "logs": {}, "error": str(e)}), 500

    @flask_app.route("/stop-container", methods=["POST"])
    def stop_container():
        """Stop and remove a specific running Jupyter container and release its hardware."""
        data = flask_request.get_json() or {}
        c_name = data.get("container_name")
        if not c_name:
            return jsonify({"status": "error", "message": "Missing container_name"}), 400

        try:
            client = docker.from_env()
            stopped = False
            for container in client.containers.list(all=True):
                if container.name == c_name or container.short_id == c_name:
                    container.stop(timeout=5)
                    try:
                        container.remove(force=True)
                    except Exception:
                        pass
                    stopped = True
                    print(f"[Agent] Stopped and reclaimed container: {container.name}")
                    break

            # Terminate associated quick tunnel
            token = c_name.replace("jupyter-", "")
            if token in active_tunnels:
                try:
                    active_tunnels[token].terminate()
                    del active_tunnels[token]
                except Exception:
                    pass

            return jsonify({
                "status": "stopped" if stopped else "not_found",
                "container_name": c_name
            }), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

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

    # Start hardware overload & thermal watchdog in background thread
    threading.Thread(target=overload_watchdog_loop, daemon=True).start()

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
