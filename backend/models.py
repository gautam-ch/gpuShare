from sqlalchemy import Column, ForeignKey, Integer, String, Float, DateTime
from sqlalchemy.orm import relationship
import datetime
from database import Base

class Machine(Base):
    __tablename__ = "machines"

    id = Column(String, primary_key=True, index=True)  # machine_id
    tailscale_ip = Column(String, index=True)
    vram_total_mb = Column(Float)
    vram_free_mb = Column(Float)
    cpus = Column(Integer)
    status = Column(String, default="offline")
    last_heartbeat = Column(DateTime, default=datetime.datetime.utcnow)

class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(String, ForeignKey("machines.id"))
    vram_required = Column(Float)
    cpus_required = Column(Integer)
    # Resource caps sent to the agent
    cpu_cores = Column(Integer, default=2)
    ram_gb = Column(Integer, default=8)
    status = Column(String, default="pending")  # pending, assigned, done, error
    token = Column(String, index=True, nullable=True)
    jupyter_url = Column(String, nullable=True)
    started_at = Column(DateTime, default=datetime.datetime.utcnow)

    machine = relationship("Machine")
