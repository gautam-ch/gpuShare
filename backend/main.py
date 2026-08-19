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

from sqlalchemy import text

# Create database tables & auto-migrate schema
Base.metadata.create_all(bind=engine)
try:
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS token VARCHAR;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS jupyter_url VARCHAR;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cpu_cores INTEGER DEFAULT 2;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ram_gb INTEGER DEFAULT 8;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP DEFAULT NOW();"))
        conn.commit()
except Exception as e:
    print(f"Schema migration note: {e}")

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
BACKEND_PUBLIC_URL = os.environ.get("BACKEND_PUBLIC_URL", "http://localhost:8000").rstrip("/")

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
    
    # Check if there are any pending or assigned jobs for this machine
    uncompleted_jobs = db.query(models.Job).filter(
        models.Job.machine_id == payload.machine_id,
        models.Job.status.in_(["pending", "assigned"])
    ).all()

    jobs_to_dispatch = []
    for j in uncompleted_jobs:
        jobs_to_dispatch.append({
            "job_id": j.id,
            "token": j.token,
            "cpu_cores": j.cpu_cores if j.cpu_cores else 2,
            "ram_gb": j.ram_gb if j.ram_gb else 8,
        })
        j.status = "assigned"
    
    db.commit()
    return {"status": "success", "jobs": jobs_to_dispatch}

class RentRequest(BaseModel):
    vram_required: float
    cpus_required: int = 1
    cpu_cores: int = 2    # CPU cores to allocate to the container
    ram_gb: int = 8       # RAM in GB to allocate to the container

class StartJupyterRequest(BaseModel):
    token: str

@app.post("/rent")
async def rent_gpu(req: RentRequest, db: Session = Depends(get_db)):
    """Match a machine by VRAM, create a job, return a one-time token and Jupyter URL."""
    vram_mb = req.vram_required * 1024  # convert GB to MB
    # Ensure machine sent a heartbeat within the last 60 seconds
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
    machine = db.query(models.Machine).filter(
        models.Machine.status == "online",
        models.Machine.last_heartbeat >= cutoff,
        models.Machine.vram_free_mb >= vram_mb,
        models.Machine.cpus >= req.cpus_required
    ).first()

    if not machine:
        raise HTTPException(status_code=404, detail="No machines available with requested resources")

    access_token = uuid.uuid4().hex

    # Create a job record with resource caps
    new_job = models.Job(
        machine_id=machine.id,
        vram_required=vram_mb,
        cpus_required=req.cpus_required,
        cpu_cores=req.cpu_cores,
        ram_gb=req.ram_gb,
        status="pending",
        token=access_token
    )
    db.add(new_job)
    machine.vram_free_mb -= vram_mb
    db.commit()
    db.refresh(new_job)

    token_store[access_token] = machine.id

    return {
        "message": "GPU reserved! Click 'Launch Jupyter' to start your session.",
        "access_token": access_token,
        "jupyter_url": None
    }

@app.post("/start-jupyter")
async def start_jupyter(req: StartJupyterRequest, db: Session = Depends(get_db)):
    """Find the job by token and return its job_id so frontend can poll status."""
    job = db.query(models.Job).filter(models.Job.token == req.token).first()
    if not job:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    machine = db.query(models.Machine).filter(models.Machine.id == job.machine_id).first()

    if job.status == "done":
        return {"status": "done", "jupyter_url": job.jupyter_url}

    return {
        "status": "pending",
        "job_id": str(job.id),
        "machine_tailscale_ip": machine.tailscale_ip if machine else "127.0.0.1"
    }

class CompleteJobPayload(BaseModel):
    job_id: int
    status: str
    jupyter_url: str = None
    detail: str = None

@app.post("/complete-job")
async def complete_job(payload: CompleteJobPayload, db: Session = Depends(get_db)):
    """Host agent posts completion result (URL or error) back to backend."""
    job = db.query(models.Job).filter(models.Job.id == payload.job_id).first()
    if job:
        job.status = payload.status
        job.jupyter_url = payload.jupyter_url if payload.status == "done" else payload.detail
        db.commit()
    return {"status": "success"}

@app.get("/session-status/{job_id}")
async def session_status(job_id: str, machine_ip: str = "127.0.0.1", db: Session = Depends(get_db)):
    """Frontend polls this to check if Jupyter + Cloudflare tunnel is ready."""
    try:
        j_id = int(job_id)
        job = db.query(models.Job).filter(models.Job.id == j_id).first()
        if job:
            if job.status == "done":
                return {"status": "done", "jupyter_url": job.jupyter_url}
            elif job.status == "error":
                return {"status": "error", "detail": job.jupyter_url or "Failed to launch Jupyter"}
    except Exception:
        pass
    return {"status": "pending"}


@app.get("/machines")
async def list_machines(db: Session = Depends(get_db)):
    """Return all registered machines — used by the host page to detect when agent connects."""
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
    machines = db.query(models.Machine).all()
    return [
        {
            "id": m.id,
            "tailscale_ip": m.tailscale_ip,
            "vram_total_mb": m.vram_total_mb,
            "vram_free_mb": m.vram_free_mb,
            "cpus": m.cpus,
            "status": m.status if m.last_heartbeat and m.last_heartbeat >= cutoff else "offline",
            "last_heartbeat": m.last_heartbeat.isoformat() if m.last_heartbeat else None,
        }
        for m in machines
    ]


# ---------------------------------------------------------------
# ADMIN DASHBOARD ENDPOINTS
# ---------------------------------------------------------------

@app.get("/admin/machines")
async def admin_machines(db: Session = Depends(get_db)):
    """Admin: return all machines with live/offline status based on heartbeat recency."""
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
    machines = db.query(models.Machine).all()
    result = []
    for m in machines:
        is_live = m.last_heartbeat and m.last_heartbeat >= cutoff
        seconds_ago = None
        if m.last_heartbeat:
            seconds_ago = int((datetime.datetime.utcnow() - m.last_heartbeat).total_seconds())
        result.append({
            "id": m.id,
            "tailscale_ip": m.tailscale_ip,
            "vram_total_mb": m.vram_total_mb,
            "vram_free_mb": m.vram_free_mb,
            "vram_used_mb": (m.vram_total_mb or 0) - (m.vram_free_mb or 0),
            "cpus": m.cpus,
            "status": "online" if is_live else "offline",
            "last_heartbeat_seconds_ago": seconds_ago,
        })
    return result


@app.get("/admin/jobs")
async def admin_jobs(db: Session = Depends(get_db)):
    """Admin: return all jobs (active and recent) with machine info."""
    jobs = db.query(models.Job).order_by(models.Job.id.desc()).limit(100).all()
    result = []
    for j in jobs:
        started_ago = None
        if j.started_at:
            started_ago = int((datetime.datetime.utcnow() - j.started_at).total_seconds())
        result.append({
            "id": j.id,
            "machine_id": j.machine_id,
            "status": j.status,
            "vram_required_mb": j.vram_required,
            "cpu_cores": j.cpu_cores,
            "ram_gb": j.ram_gb,
            "jupyter_url": j.jupyter_url,
            "started_at": j.started_at.isoformat() if j.started_at else None,
            "started_seconds_ago": started_ago,
        })
    return result


@app.get("/admin/stats")
async def admin_stats(db: Session = Depends(get_db)):
    """Admin: aggregate platform stats."""
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
    machines = db.query(models.Machine).all()
    live_machines = [m for m in machines if m.last_heartbeat and m.last_heartbeat >= cutoff]

    active_jobs = db.query(models.Job).filter(models.Job.status.in_(["pending", "assigned", "done"])).all()
    running_jobs = [j for j in active_jobs if j.status == "done" and j.jupyter_url]

    total_vram = sum(m.vram_total_mb or 0 for m in live_machines)
    free_vram = sum(m.vram_free_mb or 0 for m in live_machines)

    return {
        "total_machines": len(machines),
        "online_machines": len(live_machines),
        "offline_machines": len(machines) - len(live_machines),
        "active_renters": len(running_jobs),
        "total_vram_mb": total_vram,
        "free_vram_mb": free_vram,
        "used_vram_mb": total_vram - free_vram,
    }

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
    auth_key = TAILSCALE_AUTHKEY or ""

    script = f"""# =====================================================
# GPU Share Hub - Automatic Host Agent Installer (Windows)
# Run with: irm {BACKEND_PUBLIC_URL}/install-script-windows | iex
# =====================================================

Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  GPU Share Hub - Host Setup (Windows)"  -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host ""

# --- STEP 1: Install Tailscale ---
Write-Host "[1/4] Checking Tailscale..." -ForegroundColor Yellow
$tsExe = "C:\\Program Files\\Tailscale\\tailscale.exe"
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue) -and -not (Test-Path $tsExe)) {{
    Write-Host "    Installing Tailscale via winget..."
    winget install tailscale.tailscale -e --silent --accept-source-agreements --accept-package-agreements
    Write-Host "    Tailscale installed. Waiting for it to be ready..." -ForegroundColor Green
    Start-Sleep -Seconds 10
}} else {{
    Write-Host "    Tailscale already installed." -ForegroundColor Green
}}

# Resolve path — tailscale may not be in PATH until next shell session
if (Get-Command tailscale -ErrorAction SilentlyContinue) {{
    $TS_PATH = "tailscale"
}} elseif (Test-Path $tsExe) {{
    $TS_PATH = $tsExe
}} else {{
    Write-Host "    ERROR: Tailscale not found. Install it from https://tailscale.com/download and re-run." -ForegroundColor Red
    exit 1
}}

Write-Host "[1/4] Connecting to Tailnet (automatic)..." -ForegroundColor Yellow
& $TS_PATH up --auth-key={auth_key} --accept-routes
$TailscaleIP = (& $TS_PATH ip -4 2>$null)
Write-Host "    Connected! Tailscale IP: $TailscaleIP" -ForegroundColor Green

# --- STEP 2: Python dependencies ---
Write-Host "[2/4] Installing Python dependencies..." -ForegroundColor Yellow
pip install pynvml requests flask docker --quiet
Write-Host "    Done." -ForegroundColor Green

# --- STEP 3: Download agent ---
Write-Host "[3/4] Downloading agent..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "{BACKEND_PUBLIC_URL}/static/agent.py" -OutFile "$env:USERPROFILE\\gpu-agent.py"
if (Test-Path "$env:USERPROFILE\\gpu-agent.py") {{
    Write-Host "    Agent saved to $env:USERPROFILE\\gpu-agent.py" -ForegroundColor Green
}} else {{
    Write-Host "    ERROR: Failed to download agent. Check backend URL." -ForegroundColor Red
    exit 1
}}

# --- STEP 4: Start ---
Write-Host "[4/4] Starting agent..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Setup complete! Your machine will now appear on the platform." -ForegroundColor Green
Write-Host "   Keep this window open. Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""
$env:BACKEND_URL = "{BACKEND_PUBLIC_URL}/heartbeat"
python "$env:USERPROFILE\\gpu-agent.py"
"""
    return script


@app.get("/static/agent.py", response_class=PlainTextResponse)
async def serve_agent():
    """Serve the host agent Python script for download by the installer."""
    agent_path = pathlib.Path(__file__).parent.parent / "host-agent" / "agent.py"
    if not agent_path.exists():
        raise HTTPException(status_code=404, detail="agent.py not found on server")
    return agent_path.read_text()


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
