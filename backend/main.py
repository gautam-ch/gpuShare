from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
import datetime
import uvicorn
import uuid
import requests as http_requests
import os
import pathlib
import time

from database import engine, SessionLocal, Base
import models

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="GPU Sharing Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------
# CONFIGURATION
# Set these environment variables before running:
#   TAILSCALE_AUTHKEY  – a reusable pre-auth key from tailscale.com/admin/settings/keys
#   BACKEND_PUBLIC_URL – the public URL or Tailscale IP of THIS backend server
# ---------------------------------------------------------------
TAILSCALE_AUTHKEY = os.environ.get("TAILSCALE_AUTHKEY", "")
BACKEND_PUBLIC_URL = os.environ.get("BACKEND_PUBLIC_URL", "http://localhost:8000")

# In-memory token store: token -> machine_id
token_store: dict = {}

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class HeartbeatPayload(BaseModel):
    machine_id: str
    tailscale_ip: str
    vram_total_mb: float
    vram_free_mb: float
    cpus: int
    status: str

@app.post("/heartbeat")
async def receive_heartbeat(payload: HeartbeatPayload, db: Session = Depends(get_db)):
    machine = db.query(models.Machine).filter(models.Machine.id == payload.machine_id).first()
    
    if machine:
        machine.tailscale_ip = payload.tailscale_ip
        machine.vram_free_mb = payload.vram_free_mb
        machine.status = payload.status
        machine.last_heartbeat = datetime.datetime.utcnow()
    else:
        machine = models.Machine(
            id=payload.machine_id,
            tailscale_ip=payload.tailscale_ip,
            vram_total_mb=payload.vram_total_mb,
            vram_free_mb=payload.vram_free_mb,
            cpus=payload.cpus,
            status=payload.status
        )
        db.add(machine)
    
    db.commit()
    return {"status": "success"}

class RentRequest(BaseModel):
    vram_required: float
    cpus_required: int = 1

class StartJupyterRequest(BaseModel):
    token: str

@app.post("/rent")
async def rent_gpu(req: RentRequest, db: Session = Depends(get_db)):
    """Match a machine by VRAM, create a job, return a one-time token and Jupyter URL."""
    vram_mb = req.vram_required * 1024  # convert GB to MB
    machine = db.query(models.Machine).filter(
        models.Machine.status == "online",
        models.Machine.vram_free_mb >= vram_mb,
        models.Machine.cpus >= req.cpus_required
    ).first()

    if not machine:
        raise HTTPException(status_code=404, detail="No machines available with requested resources")

    # Create a job record
    new_job = models.Job(
        machine_id=machine.id,
        vram_required=vram_mb,
        cpus_required=req.cpus_required,
        status="pending"
    )
    db.add(new_job)
    machine.vram_free_mb -= vram_mb
    db.commit()
    db.refresh(new_job)

    # Generate a one-time access token
    access_token = uuid.uuid4().hex
    token_store[access_token] = machine.id

    return {
        "message": "GPU reserved! Click 'Launch Jupyter' to start your session.",
        "access_token": access_token,
        "jupyter_url": None  # Real URL assigned when Jupyter starts via Cloudflare tunnel
    }

@app.post("/start-jupyter")
async def start_jupyter(req: StartJupyterRequest, db: Session = Depends(get_db)):
    """Tell the host agent to start a Jupyter container. Returns the live URL."""
    machine_id = token_store.get(req.token)
    if not machine_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    machine = db.query(models.Machine).filter(models.Machine.id == machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    # Tell the host agent to launch Jupyter + Cloudflare tunnel in background
    try:
        resp = http_requests.post(
            f"http://{machine.tailscale_ip}:9000/run-jupyter",
            json={"token": req.token, "machine_ip": machine.tailscale_ip},
            timeout=10
        )
        resp.raise_for_status()
        job_id = resp.json().get("job_id")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach host agent: {e}")

    # Return job_id immediately — frontend polls /session-status/{job_id}
    return {
        "status": "pending",
        "job_id": job_id,
        "machine_tailscale_ip": machine.tailscale_ip
    }


class SessionStatusRequest(BaseModel):
    pass

@app.get("/session-status/{job_id}")
async def session_status(job_id: str, machine_ip: str, db: Session = Depends(get_db)):
    """
    Frontend polls this to check if Jupyter + Cloudflare tunnel is ready.
    Proxies to the host agent's /job-status/<job_id>.
    """
    try:
        poll = http_requests.get(
            f"http://{machine_ip}:9000/job-status/{job_id}",
            timeout=5
        )
        result = poll.json()
        if result.get("status") == "done":
            return {"status": "done", "jupyter_url": result["public_url"]}
        elif result.get("status") == "error":
            return {"status": "error", "detail": result.get("detail")}
        return {"status": "pending"}
    except Exception as e:
        return {"status": "pending"}  # Transient — keep polling


@app.get("/machines")
async def list_machines(db: Session = Depends(get_db)):
    """Return all registered machines — used by the host page to detect when agent connects."""
    machines = db.query(models.Machine).all()
    return [
        {
            "id": m.id,
            "tailscale_ip": m.tailscale_ip,
            "vram_total_mb": m.vram_total_mb,
            "vram_free_mb": m.vram_free_mb,
            "cpus": m.cpus,
            "status": m.status,
        }
        for m in machines
    ]

@app.get("/install-script", response_class=PlainTextResponse)
async def install_script_linux():
    """
    Returns a bash script that the host can run with:
      curl -sSL http://<backend>/install-script | bash
    It automatically:
      1. Installs Tailscale
      2. Authenticates with platform pre-auth key (no browser login!)
      3. Installs Python dependencies
      4. Downloads the agent
      5. Starts the agent
    """
    auth_key_line = ""
    if TAILSCALE_AUTHKEY:
        # --auth-key means Tailscale connects automatically, no browser popup needed
        auth_key_line = f"sudo tailscale up --auth-key={TAILSCALE_AUTHKEY} --accept-routes"
    else:
        auth_key_line = "sudo tailscale up  # A browser tab will open to login"

    script = f"""#!/bin/bash
# =====================================================
# GPU Share Hub — Automatic Host Agent Installer
# Generated by: {BACKEND_PUBLIC_URL}
# =====================================================
set -e

echo ""
echo "========================================"
echo "  GPU Share Hub - Host Setup"
echo "========================================"
echo ""

# --- STEP 1: Install Tailscale ---
echo "[1/4] Installing Tailscale..."
if ! command -v tailscale &> /dev/null; then
    curl -fsSL https://tailscale.com/install.sh | sh
    echo "    Tailscale installed."
else
    echo "    Tailscale already installed."
fi

echo "[1/4] Connecting to Tailnet (automatic — no login needed)..."
{auth_key_line}
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "connecting...")
echo "    Connected! Your Tailscale IP: $TAILSCALE_IP"

# --- STEP 2: Install Python dependencies ---
echo "[2/4] Installing Python dependencies..."
pip install pynvml requests flask docker --quiet
echo "    Dependencies ready."

# --- STEP 3: Download agent ---
echo "[3/4] Downloading GPU Share Hub agent..."
curl -sSL {BACKEND_PUBLIC_URL}/static/agent.py -o ~/gpu-agent.py
echo "    Agent downloaded to ~/gpu-agent.py"

# --- STEP 4: Start agent ---
echo "[4/4] Starting agent..."
echo ""
echo "✅ Setup complete! Your machine will now appear on the platform."
echo "   Keep this terminal open. Press Ctrl+C to stop."
echo ""
BACKEND_URL="{BACKEND_PUBLIC_URL}/heartbeat" python3 ~/gpu-agent.py
"""
    return script


@app.get("/install-script-windows", response_class=PlainTextResponse)
async def install_script_windows():
    """
    Returns a PowerShell script for Windows hosts.
    Run with:
      irm http://<backend>/install-script-windows | iex
    """
    auth_key_cmd = ""
    if TAILSCALE_AUTHKEY:
        auth_key_cmd = f'Start-Process tailscale -ArgumentList "up", "--auth-key={TAILSCALE_AUTHKEY}", "--accept-routes" -Wait'
    else:
        auth_key_cmd = 'Start-Process tailscale -ArgumentList "up" -Wait  # Browser will open for login'

    script = f"""# =====================================================
# GPU Share Hub — Automatic Host Agent Installer (Windows)
# Generated by: {BACKEND_PUBLIC_URL}
# Run with: irm {BACKEND_PUBLIC_URL}/install-script-windows | iex
# =====================================================

Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  GPU Share Hub - Host Setup (Windows)"  -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host ""

# --- STEP 1: Install Tailscale ---
Write-Host "[1/4] Checking Tailscale..." -ForegroundColor Yellow
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {{
    Write-Host "    Installing Tailscale via winget..."
    winget install tailscale.tailscale -e --silent
    Write-Host "    Tailscale installed. Please wait a moment..." -ForegroundColor Green
    Start-Sleep -Seconds 5
}} else {{
    Write-Host "    Tailscale already installed." -ForegroundColor Green
}}

Write-Host "[1/4] Connecting to Tailnet (automatic)..." -ForegroundColor Yellow
{auth_key_cmd}
$TailscaleIP = (tailscale ip -4 2>$null)
Write-Host "    Connected! Tailscale IP: $TailscaleIP" -ForegroundColor Green

# --- STEP 2: Python dependencies ---
Write-Host "[2/4] Installing Python dependencies..." -ForegroundColor Yellow
pip install pynvml requests flask docker --quiet
Write-Host "    Done." -ForegroundColor Green

# --- STEP 3: Download agent ---
Write-Host "[3/4] Downloading agent..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "{BACKEND_PUBLIC_URL}/static/agent.py" -OutFile "$env:USERPROFILE\\gpu-agent.py"
Write-Host "    Agent saved to $env:USERPROFILE\\gpu-agent.py" -ForegroundColor Green

# --- STEP 4: Start ---
Write-Host "[4/4] Starting agent..." -ForegroundColor Yellow
Write-Host ""
Write-Host "✅ Setup complete! Your machine will now appear on the platform." -ForegroundColor Green
Write-Host "   Keep this window open. Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""
$env:BACKEND_URL = "{BACKEND_PUBLIC_URL}/heartbeat"
python "$env:USERPROFILE\\gpu-agent.py"
"""
    return script


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
