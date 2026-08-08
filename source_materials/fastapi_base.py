from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class HeartbeatPayload(BaseModel):
    machine_id: str
    vram_total_mb: float
    vram_free_mb: float
    cpus: int
    status: str

@app.post("/heartbeat")
async def receive_heartbeat(payload: HeartbeatPayload):
    # In a real app, this updates the PostgreSQL database
    print(f"Received heartbeat from {payload.machine_id}: {payload.vram_free_mb} MB VRAM free")
    return {"status": "success"}

@app.post("/rent")
async def rent_gpu(vram_required: float, cpus_required: int):
    # Triggers SkyPilot deployment
    return {"message": f"Looking for machine with {vram_required} VRAM and {cpus_required} CPUs"}
