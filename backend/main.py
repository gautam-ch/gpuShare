from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
import datetime
import uvicorn
import uuid
import os
import pathlib
import asyncio
from typing import Optional, List

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    import requests as http_requests
    HTTPX_AVAILABLE = False

from database import engine, SessionLocal, Base
import models
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, get_current_admin,
)

from sqlalchemy import text

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = FastAPI(title="Kinetic GPU Cluster Backend")

# ---------------------------------------------------------------------------
# CORS — Allow all origins / servers (supports credentials and any domain/IP)
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r".*",
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,   # needed for Bearer token flow
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
TAILSCALE_AUTHKEY  = os.environ.get("TAILSCALE_AUTHKEY", "")
BACKEND_PUBLIC_URL = os.environ.get("BACKEND_PUBLIC_URL", "http://localhost:8000").rstrip("/")

# Env-var bootstrap credentials for the first admin account
ADMIN_EMAIL    = os.environ.get("ADMIN_EMAIL", "admin@kinetic.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme123")

# In-memory token store: jupyter_access_token -> machine_id
token_store: dict = {}

# ---------------------------------------------------------------------------
# DB dependency
# ---------------------------------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# STARTUP — create tables, run migrations, bootstrap admin
# ---------------------------------------------------------------------------
@app.on_event("startup")
def startup_db():
    """Create tables, auto-migrate schema, and seed the initial admin user."""
    Base.metadata.create_all(bind=engine)

    def safe_alter(sql):
        try:
            with engine.connect() as conn:
                conn.execute(text(sql))
                conn.commit()
        except Exception:
            pass  # Column already exists — safe to ignore

    # Legacy column migrations (kept for existing deployments)
    safe_alter("ALTER TABLE jobs ADD COLUMN token VARCHAR")
    safe_alter("ALTER TABLE jobs ADD COLUMN jupyter_url VARCHAR")
    safe_alter("ALTER TABLE jobs ADD COLUMN cpu_cores INTEGER DEFAULT 2")
    safe_alter("ALTER TABLE jobs ADD COLUMN ram_gb INTEGER DEFAULT 8")
    safe_alter("ALTER TABLE jobs ADD COLUMN started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    safe_alter("ALTER TABLE machines ADD COLUMN shared_ram_gb REAL DEFAULT 8.0")

    # New columns for auth feature
    safe_alter("ALTER TABLE jobs ADD COLUMN user_id VARCHAR")
    safe_alter("ALTER TABLE machines ADD COLUMN gpu_utilization_percent REAL DEFAULT 0.0")

    # Seed admin user from env vars if no admin exists yet
    db = SessionLocal()
    try:
        existing_admin = db.query(models.User).filter(models.User.is_admin == True).first()
        if not existing_admin:
            admin = models.User(
                id=uuid.uuid4().hex,
                email=ADMIN_EMAIL,
                password_hash=hash_password(ADMIN_PASSWORD),
                is_admin=True,
                is_active=True,
                max_vram_gb=999.0,
                max_cpu_cores=999,
                max_ram_gb=999,
            )
            db.add(admin)
            db.commit()
            print(f"[Backend] Admin user bootstrapped: {ADMIN_EMAIL}")
        else:
            print(f"[Backend] Admin already exists: {existing_admin.email}")
    finally:
        db.close()

    print("Database schema successfully initialized and migrated.")


# ---------------------------------------------------------------------------
# ROOT
# ---------------------------------------------------------------------------
@app.get("/")
async def root():
    return {"status": "ok", "service": "kinetic-gpu-backend"}


# ===========================================================================
# AUTH ENDPOINTS
# ===========================================================================

class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/auth/login")
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate with email + password. Returns a JWT access token."""
    user = db.query(models.User).filter(models.User.email == req.email).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated")

    token = create_access_token(user.id, user.is_admin)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "is_admin": user.is_admin,
            "max_vram_gb": user.max_vram_gb,
            "max_cpu_cores": user.max_cpu_cores,
            "max_ram_gb": user.max_ram_gb,
        }
    }


@app.get("/auth/me")
async def me(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return current user info + their active session (if any)."""
    active_job = db.query(models.Job).filter(
        models.Job.user_id == current_user.id,
        models.Job.status.in_(["pending", "assigned", "running", "done"])
    ).order_by(models.Job.id.desc()).first()

    active_session = None
    if active_job:
        active_session = {
            "job_id": active_job.id,
            "status": active_job.status,
            "jupyter_url": active_job.jupyter_url,
            "machine_id": active_job.machine_id,
            "started_at": active_job.started_at.isoformat() if active_job.started_at else None,
        }

    return {
        "id": current_user.id,
        "email": current_user.email,
        "is_admin": current_user.is_admin,
        "max_vram_gb": current_user.max_vram_gb,
        "max_cpu_cores": current_user.max_cpu_cores,
        "max_ram_gb": current_user.max_ram_gb,
        "active_session": active_session,
    }


# ===========================================================================
# ADMIN — USER MANAGEMENT
# ===========================================================================

class CreateUserRequest(BaseModel):
    email: str
    password: str
    max_vram_gb: float = 2.0
    max_cpu_cores: int = 2
    max_ram_gb: int = 4
    is_admin: bool = False


class UpdateUserRequest(BaseModel):
    max_vram_gb: Optional[float] = None
    max_cpu_cores: Optional[int] = None
    max_ram_gb: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


@app.post("/admin/users", status_code=201)
async def create_user(
    req: CreateUserRequest,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(get_current_admin),
):
    """Admin: create a new cluster user with resource limits."""
    existing = db.query(models.User).filter(models.User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    user = models.User(
        id=uuid.uuid4().hex,
        email=req.email,
        password_hash=hash_password(req.password),
        is_admin=req.is_admin,
        is_active=True,
        max_vram_gb=req.max_vram_gb,
        max_cpu_cores=req.max_cpu_cores,
        max_ram_gb=req.max_ram_gb,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email, "message": "User created successfully"}


@app.get("/admin/users")
async def list_users(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(get_current_admin),
):
    """Admin: list all users with their quota and active session status."""
    users = db.query(models.User).all()
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=48)
    result = []
    for u in users:
        active_job = db.query(models.Job).filter(
            models.Job.user_id == u.id,
            models.Job.status.in_(["pending", "assigned", "running", "done"])
        ).order_by(models.Job.id.desc()).first()

        started_ago = None
        if active_job and active_job.started_at:
            started_ago = int((datetime.datetime.utcnow() - active_job.started_at).total_seconds())

        result.append({
            "id": u.id,
            "email": u.email,
            "is_admin": u.is_admin,
            "is_active": u.is_active,
            "max_vram_gb": u.max_vram_gb,
            "max_cpu_cores": u.max_cpu_cores,
            "max_ram_gb": u.max_ram_gb,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "active_session": {
                "job_id": active_job.id,
                "status": active_job.status,
                "machine_id": active_job.machine_id,
                "vram_required_mb": active_job.vram_required,
                "cpu_cores": active_job.cpu_cores,
                "ram_gb": active_job.ram_gb,
                "jupyter_url": active_job.jupyter_url,
                "started_seconds_ago": started_ago,
            } if active_job else None,
        })
    return result


@app.put("/admin/users/{user_id}")
@app.patch("/admin/users/{user_id}")
async def update_user(
    user_id: str,
    req: UpdateUserRequest,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(get_current_admin),
):
    """Admin: update user quota, activation status, or password."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.max_vram_gb is not None:
        user.max_vram_gb = req.max_vram_gb
    if req.max_cpu_cores is not None:
        user.max_cpu_cores = req.max_cpu_cores
    if req.max_ram_gb is not None:
        user.max_ram_gb = req.max_ram_gb
    if req.password is not None:
        user.password_hash = hash_password(req.password)
    if req.is_active is not None:
        was_active = user.is_active
        user.is_active = req.is_active
        # If deactivating: mark any active sessions as stopping
        if was_active and not req.is_active:
            active_jobs = db.query(models.Job).filter(
                models.Job.user_id == user_id,
                models.Job.status.in_(["pending", "assigned", "running", "done"])
            ).all()
            for j in active_jobs:
                j.status = "stopping"

    db.commit()
    return {"message": "User updated successfully"}


@app.delete("/admin/users/{user_id}")
async def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """Admin: permanently delete a user (terminates their active session first)."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Terminate any active sessions first
    active_jobs = db.query(models.Job).filter(
        models.Job.user_id == user_id,
        models.Job.status.in_(["pending", "assigned", "running", "done"])
    ).all()
    for j in active_jobs:
        j.status = "stopping"

    db.delete(user)
    db.commit()
    return {"message": "User deleted successfully"}


@app.post("/admin/sessions/{job_id}/terminate")
async def admin_terminate_session(
    job_id: int,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(get_current_admin),
):
    """Admin: force-terminate any user's active session."""
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Session not found")

    machine = db.query(models.Machine).filter(models.Machine.id == job.machine_id).first()

    # Restore VRAM
    if machine and job.vram_required:
        machine.vram_free_mb = min(
            machine.vram_total_mb or 4096.0,
            (machine.vram_free_mb or 0.0) + job.vram_required
        )

    job.status = "stopping"
    db.commit()

    # Notify agent
    token_to_stop = job.token or ""
    agent_ip = machine.tailscale_ip if machine and machine.tailscale_ip else "127.0.0.1"
    agent_url = f"http://{agent_ip}:9000/stop-container"
    stop_payload = {"container_name": f"jupyter-{token_to_stop[:8]}"}

    async def _notify():
        try:
            if HTTPX_AVAILABLE:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    await client.post(agent_url, json=stop_payload)
            else:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, lambda: http_requests.post(agent_url, json=stop_payload, timeout=2))
        except Exception:
            pass

    asyncio.create_task(_notify())
    return {"message": "Session terminated"}


# ===========================================================================
# ADMIN — DASHBOARD OVERVIEW
# ===========================================================================

@app.get("/admin/dashboard")
async def admin_dashboard(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(get_current_admin),
):
    """Admin: full cluster overview — machines, active sessions, user activity."""
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
    machines = db.query(models.Machine).all()
    live_machines = [m for m in machines if m.last_heartbeat and m.last_heartbeat >= cutoff]

    active_jobs = db.query(models.Job).filter(
        models.Job.status.in_(["pending", "assigned", "running", "done"])
    ).all()

    total_vram   = sum(m.vram_total_mb or 0 for m in live_machines)
    free_vram    = sum(m.vram_free_mb or 0 for m in live_machines)
    total_users  = db.query(models.User).filter(models.User.is_active == True).count()

    # Enrich active jobs with user email + machine gpu util
    machine_map = {m.id: m for m in machines}
    user_ids = [j.user_id for j in active_jobs if j.user_id]
    users_map = {}
    if user_ids:
        users = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
        users_map = {u.id: u for u in users}

    sessions = []
    for j in active_jobs:
        m = machine_map.get(j.machine_id)
        u = users_map.get(j.user_id) if j.user_id else None
        started_ago = int((datetime.datetime.utcnow() - j.started_at).total_seconds()) if j.started_at else None
        sessions.append({
            "job_id": j.id,
            "user_email": u.email if u else "unknown",
            "machine_id": j.machine_id,
            "machine_ip": m.tailscale_ip if m else None,
            "gpu_utilization_percent": m.gpu_utilization_percent if m else None,
            "vram_required_mb": j.vram_required,
            "cpu_cores": j.cpu_cores,
            "ram_gb": j.ram_gb,
            "status": j.status,
            "jupyter_url": j.jupyter_url,
            "started_seconds_ago": started_ago,
        })

    machine_list = []
    for m in machines:
        is_live = m.last_heartbeat and m.last_heartbeat >= cutoff
        seconds_ago = int((datetime.datetime.utcnow() - m.last_heartbeat).total_seconds()) if m.last_heartbeat else None
        machine_list.append({
            "id": m.id,
            "tailscale_ip": m.tailscale_ip,
            "vram_total_mb": m.vram_total_mb,
            "vram_free_mb": m.vram_free_mb,
            "vram_used_mb": (m.vram_total_mb or 0) - (m.vram_free_mb or 0),
            "cpus": m.cpus,
            "shared_ram_gb": m.shared_ram_gb,
            "gpu_utilization_percent": m.gpu_utilization_percent,
            "status": "online" if is_live else "offline",
            "last_heartbeat_seconds_ago": seconds_ago,
        })

    return {
        "stats": {
            "total_machines": len(machines),
            "online_machines": len(live_machines),
            "offline_machines": len(machines) - len(live_machines),
            "active_sessions": len(active_jobs),
            "total_users": total_users,
            "total_vram_mb": total_vram,
            "free_vram_mb": free_vram,
            "used_vram_mb": total_vram - free_vram,
        },
        "machines": machine_list,
        "active_sessions": sessions,
    }


# Keep legacy individual admin endpoints for backward compat
@app.get("/admin/machines")
async def admin_machines(db: Session = Depends(get_db), _admin: models.User = Depends(get_current_admin)):
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
    machines = db.query(models.Machine).all()
    return [{
        "id": m.id, "tailscale_ip": m.tailscale_ip,
        "vram_total_mb": m.vram_total_mb, "vram_free_mb": m.vram_free_mb,
        "vram_used_mb": (m.vram_total_mb or 0) - (m.vram_free_mb or 0),
        "cpus": m.cpus, "gpu_utilization_percent": m.gpu_utilization_percent,
        "status": "online" if (m.last_heartbeat and m.last_heartbeat >= cutoff) else "offline",
        "last_heartbeat_seconds_ago": int((datetime.datetime.utcnow() - m.last_heartbeat).total_seconds()) if m.last_heartbeat else None,
    } for m in machines]


@app.get("/admin/jobs")
async def admin_jobs(db: Session = Depends(get_db), _admin: models.User = Depends(get_current_admin)):
    jobs = db.query(models.Job).order_by(models.Job.id.desc()).limit(100).all()
    return [{
        "id": j.id, "machine_id": j.machine_id, "user_id": j.user_id,
        "status": j.status, "token": j.token,
        "vram_required_mb": j.vram_required, "cpu_cores": j.cpu_cores, "ram_gb": j.ram_gb,
        "jupyter_url": j.jupyter_url,
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "started_seconds_ago": int((datetime.datetime.utcnow() - j.started_at).total_seconds()) if j.started_at else None,
    } for j in jobs]


@app.get("/admin/stats")
async def admin_stats(db: Session = Depends(get_db), _admin: models.User = Depends(get_current_admin)):
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
    machines = db.query(models.Machine).all()
    live = [m for m in machines if m.last_heartbeat and m.last_heartbeat >= cutoff]
    active_jobs = db.query(models.Job).filter(models.Job.status.in_(["pending", "assigned", "running", "done"])).all()
    running_jobs = [j for j in active_jobs if j.status in ("running", "done") and j.jupyter_url]
    total_vram = sum(m.vram_total_mb or 0 for m in live)
    free_vram  = sum(m.vram_free_mb or 0 for m in live)
    return {
        "total_machines": len(machines), "online_machines": len(live),
        "offline_machines": len(machines) - len(live),
        "active_renters": len(running_jobs),
        "total_vram_mb": total_vram, "free_vram_mb": free_vram,
        "used_vram_mb": total_vram - free_vram,
    }


# ===========================================================================
# HEARTBEAT (host-agent → backend)
# ===========================================================================

class HeartbeatPayload(BaseModel):
    machine_id: str
    tailscale_ip: str
    vram_total_mb: float
    vram_free_mb: float
    cpus: int
    shared_ram_gb: float = 8.0
    status: str
    gpu_utilization_percent: float = 0.0   # NEW: added for idle TTL checks


@app.post("/heartbeat")
async def receive_heartbeat(payload: HeartbeatPayload, db: Session = Depends(get_db)):
    machine = db.query(models.Machine).filter(models.Machine.id == payload.machine_id).first()

    # Auto-expire stale jobs (> 30 min with no completion signal → agent/host crashed)
    stale_cutoff = datetime.datetime.utcnow() - datetime.timedelta(minutes=30)
    stale_jobs = db.query(models.Job).filter(
        models.Job.machine_id == payload.machine_id,
        models.Job.status.in_(["assigned", "running"]),
        models.Job.started_at < stale_cutoff
    ).all()
    for stale in stale_jobs:
        stale.status = "error"
        print(f"[Backend] Job #{stale.id} marked error — exceeded 30-min TTL with no completion")

    db.flush()

    # GPU-activity based long-session TTL:
    # After 8h: if GPU idle (< 5% util for this machine) → kill. If busy → extend (up to 48h hard cap).
    eight_hours_ago  = datetime.datetime.utcnow() - datetime.timedelta(hours=8)
    forty_eight_ago  = datetime.datetime.utcnow() - datetime.timedelta(hours=48)

    long_sessions = db.query(models.Job).filter(
        models.Job.machine_id == payload.machine_id,
        models.Job.status.in_(["running", "done"]),
        models.Job.started_at <= eight_hours_ago
    ).all()

    for ls in long_sessions:
        if ls.started_at and ls.started_at <= forty_eight_ago:
            ls.status = "stopping"
            print(f"[Backend] Job #{ls.id} hard-capped at 48h — terminating")
        elif payload.gpu_utilization_percent < 5.0:
            ls.status = "stopping"
            print(f"[Backend] Job #{ls.id} GPU idle ({payload.gpu_utilization_percent:.1f}%) after 8h — terminating")
        # else: GPU busy → leave running (extend silently)

    db.flush()

    # Calculate effective free VRAM (subtract active job allocations)
    active_statuses = ["pending", "assigned", "running"]
    active_jobs = db.query(models.Job).filter(
        models.Job.machine_id == payload.machine_id,
        models.Job.status.in_(active_statuses)
    ).all()
    allocated_vram_mb = sum(j.vram_required or 0.0 for j in active_jobs)
    effective_free_mb = max(0.0, payload.vram_free_mb - allocated_vram_mb)

    if machine:
        machine.tailscale_ip             = payload.tailscale_ip
        machine.vram_total_mb            = payload.vram_total_mb
        machine.vram_free_mb             = effective_free_mb
        machine.cpus                     = payload.cpus
        machine.shared_ram_gb            = payload.shared_ram_gb
        machine.status                   = payload.status
        machine.gpu_utilization_percent  = payload.gpu_utilization_percent
        machine.last_heartbeat           = datetime.datetime.utcnow()
    else:
        machine = models.Machine(
            id=payload.machine_id,
            tailscale_ip=payload.tailscale_ip,
            vram_total_mb=payload.vram_total_mb,
            vram_free_mb=effective_free_mb,
            cpus=payload.cpus,
            shared_ram_gb=payload.shared_ram_gb,
            status=payload.status,
            gpu_utilization_percent=payload.gpu_utilization_percent,
        )
        db.add(machine)

    # Dispatch PENDING jobs to agent
    pending_jobs = db.query(models.Job).filter(
        models.Job.machine_id == payload.machine_id,
        models.Job.status == "pending"
    ).all()
    jobs_to_dispatch = []
    for j in pending_jobs:
        jobs_to_dispatch.append({
            "job_id": j.id,
            "token": j.token,
            "cpu_cores": j.cpu_cores or 2,
            "ram_gb": j.ram_gb or 8,
            "vram_gb": (j.vram_required / 1024.0) if j.vram_required else 2.0,
        })
        j.status = "assigned"

    # Dispatch STOPPING jobs
    stopping_jobs = db.query(models.Job).filter(
        models.Job.machine_id == payload.machine_id,
        models.Job.status == "stopping"
    ).all()
    jobs_to_stop = []
    for sj in stopping_jobs:
        jobs_to_stop.append({"job_id": sj.id, "token": sj.token})
        sj.status = "stopped"

    db.commit()
    return {"status": "success", "jobs": jobs_to_dispatch, "stop_jobs": jobs_to_stop}


# ===========================================================================
# RENT (auth-protected)
# ===========================================================================

class RentRequest(BaseModel):
    vram_required: float
    cpu_cores: int = 2
    ram_gb: int = 4


@app.post("/rent")
async def rent_gpu(
    req: RentRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Reserve a GPU on the cluster. Enforces per-user quota and one-session-per-user rule."""

    # --- 1. One active session per user ---
    existing_session = db.query(models.Job).filter(
        models.Job.user_id == current_user.id,
        models.Job.status.in_(["pending", "assigned", "running", "done"])
    ).first()
    if existing_session:
        raise HTTPException(
            status_code=409,
            detail="You already have an active session. Stop it before starting a new one."
        )

    # --- 2. Enforce user quota ---
    if req.vram_required > current_user.max_vram_gb:
        raise HTTPException(
            status_code=400,
            detail=f"Requested {req.vram_required} GB VRAM exceeds your quota of {current_user.max_vram_gb} GB."
        )
    if req.cpu_cores > current_user.max_cpu_cores:
        raise HTTPException(
            status_code=400,
            detail=f"Requested {req.cpu_cores} CPU cores exceeds your quota of {current_user.max_cpu_cores} cores."
        )
    if req.ram_gb > current_user.max_ram_gb:
        raise HTTPException(
            status_code=400,
            detail=f"Requested {req.ram_gb} GB RAM exceeds your quota of {current_user.max_ram_gb} GB."
        )

    vram_mb = req.vram_required * 1024
    vram_match_threshold = max(vram_mb - 512, vram_mb * 0.85)

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=120)
    online_machines = db.query(models.Machine).filter(
        models.Machine.status == "online",
        models.Machine.last_heartbeat >= cutoff,
    ).all()

    if not online_machines:
        raise HTTPException(status_code=404, detail="No GPU machines are currently online in this cluster.")

    max_vram_avail = max((m.vram_free_mb or 0) for m in online_machines) / 1024

    # --- 3. Find matching machine by free VRAM only (no double-booking via total) ---
    machine = db.query(models.Machine).filter(
        models.Machine.status == "online",
        models.Machine.last_heartbeat >= cutoff,
        models.Machine.vram_free_mb >= vram_match_threshold,
        models.Machine.cpus >= req.cpu_cores,
    ).first()

    if not machine:
        raise HTTPException(
            status_code=404,
            detail=f"No machine with {req.vram_required:.1f} GB free VRAM available right now. Max available: {max_vram_avail:.1f} GB."
        )

    # Check RAM limit against machine's shared_ram_gb
    if req.ram_gb > (machine.shared_ram_gb or 999):
        raise HTTPException(
            status_code=400,
            detail=f"Requested {req.ram_gb} GB RAM exceeds this machine's shared limit of {machine.shared_ram_gb} GB."
        )

    access_token = uuid.uuid4().hex

    new_job = models.Job(
        machine_id=machine.id,
        user_id=current_user.id,
        vram_required=vram_mb,
        cpus_required=req.cpu_cores,
        cpu_cores=req.cpu_cores,
        ram_gb=req.ram_gb,
        status="pending",
        token=access_token,
    )
    db.add(new_job)
    machine.vram_free_mb = max(0.0, (machine.vram_free_mb or 0.0) - vram_mb)
    db.commit()
    db.refresh(new_job)

    token_store[access_token] = machine.id

    return {
        "message": "GPU reserved! Click 'Launch Jupyter' to start your session.",
        "access_token": access_token,
        "job_id": new_job.id,
        "jupyter_url": None,
    }


# ===========================================================================
# STOP SESSION (auth-protected)
# ===========================================================================

class StopSessionRequest(BaseModel):
    token: str = ""
    job_id: int = 0


@app.post("/stop-session")
async def stop_session(
    req: StopSessionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Stop the current user's active session."""
    query = db.query(models.Job)
    job = None
    if req.token:
        job = query.filter(models.Job.token == req.token).first()
    if not job and req.job_id:
        job = query.filter(models.Job.id == req.job_id).first()
    if not job:
        # Fall back to most recent active session owned by this user
        job = query.filter(
            models.Job.user_id == current_user.id,
            models.Job.status.in_(["assigned", "running", "done", "pending"])
        ).order_by(models.Job.id.desc()).first()

    if not job:
        return {"status": "no_active_session", "message": "No active session found"}

    # Users can only stop their own sessions (admins bypass this)
    if job.user_id and job.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Cannot stop another user's session")

    job.status = "stopping"

    machine = db.query(models.Machine).filter(models.Machine.id == job.machine_id).first()
    if machine and job.vram_required:
        machine.vram_free_mb = min(
            machine.vram_total_mb or 4096.0,
            (machine.vram_free_mb or 0.0) + job.vram_required
        )
    db.commit()

    token_to_stop = job.token or ""
    agent_ip  = machine.tailscale_ip if machine and machine.tailscale_ip else "127.0.0.1"
    agent_url = f"http://{agent_ip}:9000/stop-container"
    stop_payload = {"container_name": f"jupyter-{token_to_stop[:8]}"}

    async def _notify():
        try:
            if HTTPX_AVAILABLE:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    await client.post(agent_url, json=stop_payload)
            else:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, lambda: http_requests.post(agent_url, json=stop_payload, timeout=2))
        except Exception:
            pass

    asyncio.create_task(_notify())
    return {"status": "success", "message": "Session termination initiated", "job_id": job.id}


# ===========================================================================
# START JUPYTER / SESSION STATUS / COMPLETE JOB (unchanged logic)
# ===========================================================================

class StartJupyterRequest(BaseModel):
    token: str


@app.post("/start-jupyter")
async def start_jupyter(
    req: StartJupyterRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    job = db.query(models.Job).filter(models.Job.token == req.token).first()
    if not job:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    machine = db.query(models.Machine).filter(models.Machine.id == job.machine_id).first()
    if job.status == "done":
        return {"status": "done", "jupyter_url": job.jupyter_url}
    return {
        "status": "pending",
        "job_id": str(job.id),
        "machine_tailscale_ip": machine.tailscale_ip if machine else "127.0.0.1",
    }


@app.get("/session-status/{job_id}")
async def session_status(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        j_id = int(job_id)
        job = db.query(models.Job).filter(models.Job.id == j_id).first()
        if job:
            if job.status in ("done", "running") and job.jupyter_url:
                return {"status": "done", "jupyter_url": job.jupyter_url}
            elif job.status == "error":
                return {"status": "error", "detail": job.jupyter_url or "Failed to launch Jupyter"}
    except Exception:
        pass
    return {"status": "pending"}


class CompleteJobPayload(BaseModel):
    job_id: int
    status: str
    jupyter_url: Optional[str] = None
    detail: Optional[str] = None


@app.post("/complete-job")
async def complete_job(payload: CompleteJobPayload, db: Session = Depends(get_db)):
    """Host agent posts job lifecycle update (no auth — internal agent call)."""
    job = db.query(models.Job).filter(models.Job.id == payload.job_id).first()
    if not job:
        return {"status": "not_found"}

    job.status = payload.status
    if payload.status in ("running", "done") and payload.jupyter_url:
        job.jupyter_url = payload.jupyter_url
    elif payload.status == "error" and payload.detail:
        job.jupyter_url = payload.detail

    if payload.status == "error" and job.vram_required:
        machine = db.query(models.Machine).filter(models.Machine.id == job.machine_id).first()
        if machine:
            machine.vram_free_mb = min(
                machine.vram_total_mb or 4096.0,
                (machine.vram_free_mb or 0.0) + job.vram_required
            )
    db.commit()
    return {"status": "success"}


# ===========================================================================
# PUBLIC MACHINES LIST (for host registration page — no auth)
# ===========================================================================

@app.get("/machines")
async def list_machines(db: Session = Depends(get_db)):
    """Public: only returns online machines (used by /host page to detect agent connection)."""
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(seconds=60)
    machines = db.query(models.Machine).filter(
        models.Machine.last_heartbeat >= cutoff,
        models.Machine.status == "online"
    ).all()
    return [{
        "id": m.id,
        "tailscale_ip": m.tailscale_ip,
        "vram_total_mb": m.vram_total_mb,
        "vram_free_mb": m.vram_free_mb,
        "cpus": m.cpus,
        "shared_ram_gb": m.shared_ram_gb or 8.0,
        "status": m.status,
        "gpu_utilization_percent": m.gpu_utilization_percent,
        "last_heartbeat": m.last_heartbeat.isoformat() if m.last_heartbeat else None,
    } for m in machines]


# ===========================================================================
# INSTALL SCRIPTS
# ===========================================================================

@app.get("/install-script", response_class=PlainTextResponse)
async def install_script_linux():
    auth_key_line = (
        f"sudo tailscale up --auth-key={TAILSCALE_AUTHKEY} --accept-routes"
        if TAILSCALE_AUTHKEY else
        "sudo tailscale up  # A browser tab will open to login"
    )
    script = f"""#!/bin/bash
# Kinetic GPU Cluster — Automatic Host Agent Installer
set -e
echo "[1/4] Installing Tailscale..."
if ! command -v tailscale &> /dev/null; then
    curl -fsSL https://tailscale.com/install.sh | sh
fi
{auth_key_line}
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "connecting...")
echo "    Tailscale IP: $TAILSCALE_IP"
echo "[2/4] Installing Python dependencies..."
pip install pynvml requests flask docker --quiet
echo "[3/4] Downloading agent..."
curl -sSL {BACKEND_PUBLIC_URL}/static/agent.py -o ~/gpu-agent.py
echo "[4/4] Starting agent..."
BACKEND_URL="{BACKEND_PUBLIC_URL}/heartbeat" python3 ~/gpu-agent.py
"""
    return script


@app.get("/install-script-windows", response_class=PlainTextResponse)
async def install_script_windows():
    auth_key = TAILSCALE_AUTHKEY or ""
    script = f"""# Kinetic GPU Cluster — Windows Host Agent Installer
Write-Host "Kinetic GPU Cluster - Windows Setup" -ForegroundColor Cyan
$tsExe = "C:\\Program Files\\Tailscale\\tailscale.exe"
if (-not (Get-Command tailscale -ErrorAction SilentlyContinue) -and -not (Test-Path $tsExe)) {{
    winget install tailscale.tailscale -e --silent --accept-source-agreements --accept-package-agreements
    Start-Sleep -Seconds 10
}}
if (Get-Command tailscale -ErrorAction SilentlyContinue) {{ $TS_PATH = "tailscale" }}
elseif (Test-Path $tsExe) {{ $TS_PATH = $tsExe }}
else {{ Write-Host "Tailscale not found." -ForegroundColor Red; exit 1 }}
& $TS_PATH up --auth-key={auth_key} --accept-routes
pip install pynvml requests flask docker --quiet
Invoke-WebRequest -Uri "{BACKEND_PUBLIC_URL}/static/agent.py" -OutFile "$env:USERPROFILE\\gpu-agent.py"
$env:BACKEND_URL = "{BACKEND_PUBLIC_URL}/heartbeat"
python "$env:USERPROFILE\\gpu-agent.py"
"""
    return script


@app.get("/static/agent.py", response_class=PlainTextResponse)
async def serve_agent():
    agent_path = pathlib.Path(__file__).parent.parent / "host-agent" / "agent.py"
    if not agent_path.exists():
        raise HTTPException(status_code=404, detail="agent.py not found on server")
    return agent_path.read_text()


@app.get("/static/Dockerfile", response_class=PlainTextResponse)
async def serve_dockerfile():
    df_path = pathlib.Path(__file__).parent.parent / "docker" / "Dockerfile"
    if not df_path.exists():
        raise HTTPException(status_code=404, detail="Dockerfile not found on server")
    return df_path.read_text()


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
