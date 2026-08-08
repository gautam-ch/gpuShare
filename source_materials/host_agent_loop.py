import time
import requests
import pynvml
import subprocess

# Standard boilerplate for a heartbeat loop
BACKEND_URL = "http://localhost:8000/heartbeat"
MACHINE_ID = "machine-001"

def get_tailscale_ip():
    try:
        # Automatically grab the Tailscale IP from the system
        result = subprocess.run(['tailscale', 'ip', '-4'], capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except Exception:
        return "0.0.0.0"

def send_heartbeat():
    pynvml.nvmlInit()
    handle = pynvml.nvmlDeviceGetHandleByIndex(0)
    info = pynvml.nvmlDeviceGetMemoryInfo(handle)
    
    # Get IP automatically!
    tailscale_ip = get_tailscale_ip()
    
    payload = {
        "machine_id": MACHINE_ID,
        "tailscale_ip": tailscale_ip, # <-- Sent automatically to the backend
        "vram_total_mb": info.total / 1024**2,
        "vram_free_mb": info.free / 1024**2,
        "cpus": 2, 
        "status": "online"
    }
    
    try:
        response = requests.post(BACKEND_URL, json=payload)
        print("Heartbeat sent:", response.status_code)
    except Exception as e:
        print("Failed to send heartbeat:", e)
    finally:
        pynvml.nvmlShutdown()

if __name__ == "__main__":
    while True:
        send_heartbeat()
        time.sleep(15)
