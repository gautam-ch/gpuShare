from sqlalchemy import Column, ForeignKey, Integer, String, Float, DateTime, Boolean
from sqlalchemy.orm import relationship
import datetime
from database import Base


class User(Base):
    __tablename__ = "users"

    id            = Column(String, primary_key=True, index=True, default=lambda: __import__('uuid').uuid4().hex)
    email         = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    is_admin      = Column(Boolean, default=False)
    is_active     = Column(Boolean, default=True)
    # Per-user resource quota set by admin
    max_vram_gb   = Column(Float, default=2.0)
    max_cpu_cores = Column(Integer, default=2)
    max_ram_gb    = Column(Integer, default=4)
    created_at    = Column(DateTime, default=datetime.datetime.utcnow)

    jobs = relationship("Job", back_populates="user")


class Machine(Base):
    __tablename__ = "machines"

    id                      = Column(String, primary_key=True, index=True)
    tailscale_ip            = Column(String, index=True)
    vram_total_mb           = Column(Float)
    vram_free_mb            = Column(Float)
    cpus                    = Column(Integer)
    shared_ram_gb           = Column(Float, default=8.0)
    status                  = Column(String, default="offline")
    last_heartbeat          = Column(DateTime, default=datetime.datetime.utcnow)
    gpu_utilization_percent = Column(Float, default=0.0)   # reported by agent heartbeat


class Job(Base):
    __tablename__ = "jobs"

    id           = Column(Integer, primary_key=True, index=True)
    machine_id   = Column(String, ForeignKey("machines.id"))
    user_id      = Column(String, ForeignKey("users.id"), nullable=True)  # nullable for legacy rows
    vram_required  = Column(Float)
    cpus_required  = Column(Integer)
    cpu_cores      = Column(Integer, default=2)
    ram_gb         = Column(Integer, default=8)
    status         = Column(String, default="pending")  # pending/assigned/running/done/stopping/stopped/error
    token          = Column(String, index=True, nullable=True)
    jupyter_url    = Column(String, nullable=True)
    started_at     = Column(DateTime, default=datetime.datetime.utcnow)

    machine = relationship("Machine")
    user    = relationship("User", back_populates="jobs")
