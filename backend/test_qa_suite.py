"""
test_qa_suite.py — Comprehensive QA test suite covering the entire
Central Machine Authentication & Multi-User Cluster Management system.
"""
import uuid
from fastapi.testclient import TestClient
from main import app, startup_db
import models
from database import SessionLocal

def run_tests():
    print("=" * 60)
    print("Running Kinetic GPU Cluster QA Suite")
    print("=" * 60)
    
    # 1. Ensure startup DB migrations & admin user exist
    startup_db()
    client = TestClient(app)
    
    # 2. Test Admin Login
    print("\n[Test 1] Admin Login...")
    resp = client.post("/auth/login", json={
        "email": "admin@kinetic.local",
        "password": "changeme123"
    })
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    admin_data = resp.json()
    admin_token = admin_data["access_token"]
    assert admin_data["user"]["is_admin"] is True
    print("  PASS: Admin logged in successfully, token received.")
    
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    
    # 3. Test Invalid Login
    print("\n[Test 2] Invalid Password...")
    resp = client.post("/auth/login", json={
        "email": "admin@kinetic.local",
        "password": "wrongpassword"
    })
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
    print("  PASS: Invalid password correctly rejected (401).")
    
    # 4. Test GET /auth/me
    print("\n[Test 3] GET /auth/me for Admin...")
    resp = client.get("/auth/me", headers=admin_headers)
    assert resp.status_code == 200
    me = resp.json()
    assert me["email"] == "admin@kinetic.local"
    assert me["is_admin"] is True
    print("  PASS: /auth/me returned correct profile.")

    # 5. Create a Student User via Admin API
    student_email = f"student_{uuid.uuid4().hex[:6]}@college.edu"
    print(f"\n[Test 4] Admin creates student: {student_email} with 4GB VRAM, 4 cores, 8GB RAM quota...")
    resp = client.post("/admin/users", headers=admin_headers, json={
        "email": student_email,
        "password": "studentpass123",
        "is_admin": False,
        "max_vram_gb": 4.0,
        "max_cpu_cores": 4,
        "max_ram_gb": 8
    })
    assert resp.status_code == 201, f"User creation failed: {resp.text}"
    student_id = resp.json()["id"]
    print("  PASS: Student account created.")

    # 6. Student Login
    print("\n[Test 5] Student logs in...")
    resp = client.post("/auth/login", json={
        "email": student_email,
        "password": "studentpass123"
    })
    assert resp.status_code == 200
    student_data = resp.json()
    student_token = student_data["access_token"]
    assert student_data["user"]["is_admin"] is False
    assert student_data["user"]["max_vram_gb"] == 4.0
    student_headers = {"Authorization": f"Bearer {student_token}"}
    print("  PASS: Student logged in successfully with assigned quotas.")

    # 7. Student tries to access Admin Dashboard (Should be Forbidden 403)
    print("\n[Test 6] Student tries to access Admin Dashboard...")
    resp = client.get("/admin/dashboard", headers=student_headers)
    assert resp.status_code == 403, f"Expected 403 Forbidden, got {resp.status_code}"
    print("  PASS: Student access to admin dashboard properly blocked (403).")

    # 8. Admin accesses Dashboard
    print("\n[Test 7] Admin accesses Dashboard...")
    resp = client.get("/admin/dashboard", headers=admin_headers)
    assert resp.status_code == 200
    dash = resp.json()
    assert "stats" in dash
    assert "machines" in dash
    assert "active_sessions" in dash
    users_resp = client.get("/admin/users", headers=admin_headers)
    assert users_resp.status_code == 200
    assert len(users_resp.json()) >= 2
    print(f"  PASS: Admin dashboard retrieved. Stats: {dash['stats']}")

    # 9. Test Machine Heartbeat with GPU utilization
    print("\n[Test 8] Registering test GPU machine via /heartbeat...")
    machine_id = f"test-gpu-{uuid.uuid4().hex[:6]}"
    resp = client.post("/heartbeat", json={
        "machine_id": machine_id,
        "tailscale_ip": "100.64.0.99",
        "vram_total_mb": 16384.0,
        "vram_free_mb": 16384.0,
        "cpus": 16,
        "shared_ram_gb": 32.0,
        "status": "online",
        "gpu_utilization_percent": 12.5
    })
    assert resp.status_code == 200, f"Heartbeat failed: {resp.text}"
    print("  PASS: Host machine heartbeat accepted with 12.5% GPU utilization.")

    # 10. Student requests GPU EXCEEDING Quota (e.g. 8GB VRAM when limit is 4GB)
    print("\n[Test 9] Student requests 8GB VRAM (Quota: 4GB)...")
    resp = client.post("/rent", headers=student_headers, json={
        "vram_required": 8.0,
        "cpu_cores": 2,
        "ram_gb": 4
    })
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    assert "exceeds your quota" in resp.json()["detail"].lower()
    print(f"  PASS: Exceeded VRAM quota correctly blocked: {resp.json()['detail']}")

    # 11. Student requests CPU cores EXCEEDING Quota (e.g. 8 cores when limit is 4)
    print("\n[Test 10] Student requests 8 CPU cores (Quota: 4)...")
    resp = client.post("/rent", headers=student_headers, json={
        "vram_required": 2.0,
        "cpu_cores": 8,
        "ram_gb": 4
    })
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    assert "exceeds your quota" in resp.json()["detail"].lower()
    print(f"  PASS: Exceeded CPU quota correctly blocked: {resp.json()['detail']}")

    # 12. Student requests GPU WITHIN Quota (e.g. 3GB VRAM, 2 cores, 4GB RAM)
    print("\n[Test 11] Student rents GPU within quota (3GB VRAM, 2 cores, 4GB RAM)...")
    resp = client.post("/rent", headers=student_headers, json={
        "vram_required": 3.0,
        "cpu_cores": 2,
        "ram_gb": 4
    })
    assert resp.status_code == 200, f"Rent failed: {resp.text}"
    rent_data = resp.json()
    job_id = rent_data["job_id"]
    access_token = rent_data["access_token"]
    print(f"  PASS: GPU rented! Job #{job_id}, Token: {access_token[:8]}...")

    # 13. Student attempts SECOND concurrent session (One active session per user rule)
    print("\n[Test 12] Student attempts second concurrent session...")
    resp = client.post("/rent", headers=student_headers, json={
        "vram_required": 1.0,
        "cpu_cores": 1,
        "ram_gb": 2
    })
    assert resp.status_code == 409, f"Expected 409 Conflict, got {resp.status_code}"
    assert "already have an active session" in resp.json()["detail"]
    print(f"  PASS: Second active session blocked with 409 Conflict.")

    # 14. Heartbeat dispatches the pending job
    print("\n[Test 13] Host agent heartbeat checks for dispatched jobs...")
    resp = client.post("/heartbeat", json={
        "machine_id": machine_id,
        "tailscale_ip": "100.64.0.99",
        "vram_total_mb": 16384.0,
        "vram_free_mb": 13312.0,
        "cpus": 16,
        "shared_ram_gb": 32.0,
        "status": "online",
        "gpu_utilization_percent": 15.0
    })
    hb_data = resp.json()
    dispatched = hb_data.get("jobs", [])
    assert any(j["job_id"] == job_id for j in dispatched), "Job not dispatched in heartbeat"
    print(f"  PASS: Agent received job #{job_id} for execution.")

    # 15. Host agent marks job done / sets jupyter_url
    print("\n[Test 14] Host agent reports job running with Jupyter URL...")
    resp = client.post("/complete-job", json={
        "job_id": job_id,
        "status": "done",
        "jupyter_url": f"http://100.64.0.99:8888/lab?token={access_token}"
    })
    assert resp.status_code == 200
    print("  PASS: Job marked done with active Jupyter URL.")

    # 16. Verify session status endpoint
    print("\n[Test 15] Checking session status via /session-status/{job_id}...")
    resp = client.get(f"/session-status/{job_id}", headers=student_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"
    assert resp.json()["jupyter_url"] is not None
    print("  PASS: Session status confirmed.")

    # 17. Admin sees active session on dashboard
    print("\n[Test 16] Admin dashboard lists the active session...")
    resp = client.get("/admin/dashboard", headers=admin_headers)
    dash = resp.json()
    active_jobs = [s for s in dash["active_sessions"] if s["job_id"] == job_id]
    assert len(active_jobs) == 1, "Session not found in admin active_sessions"
    assert active_jobs[0]["user_email"] == student_email
    print(f"  PASS: Admin dashboard shows student {student_email} running job #{job_id}.")

    # 18. Student stops session
    print("\n[Test 17] Student stops their session via /stop-session...")
    resp = client.post("/stop-session", headers=student_headers, json={"job_id": job_id})
    assert resp.status_code == 200
    print("  PASS: Session stopped.")

    # 19. Now student can rent again since previous session is stopped
    print("\n[Test 18] Verifying student can rent after stopping previous session...")
    resp = client.post("/rent", headers=student_headers, json={
        "vram_required": 2.0,
        "cpu_cores": 2,
        "ram_gb": 4
    })
    assert resp.status_code == 200
    new_job_id = resp.json()["job_id"]
    print(f"  PASS: Student successfully started new session (Job #{new_job_id}).")

    # 20. Admin force-terminates the new session
    print(f"\n[Test 19] Admin force-terminates Job #{new_job_id}...")
    resp = client.post(f"/admin/sessions/{new_job_id}/terminate", headers=admin_headers)
    assert resp.status_code == 200
    print("  PASS: Admin force-terminated session.")

    # 21. Admin updates student quota (PATCH /admin/users/{id})
    print(f"\n[Test 20] Admin increases student quota to 8GB VRAM...")
    resp = client.patch(f"/admin/users/{student_id}", headers=admin_headers, json={
        "max_vram_gb": 8.0,
        "max_cpu_cores": 8,
        "max_ram_gb": 16
    })
    assert resp.status_code == 200
    me_resp = client.get("/auth/me", headers=student_headers)
    assert me_resp.json()["max_vram_gb"] == 8.0
    print("  PASS: Student quota updated by admin.")

    # 22. Deactivate student account
    print(f"\n[Test 21] Admin deactivates student account...")
    resp = client.patch(f"/admin/users/{student_id}", headers=admin_headers, json={
        "is_active": False
    })
    assert resp.status_code == 200
    
    # Verify deactivated user cannot log in
    resp = client.post("/auth/login", json={
        "email": student_email,
        "password": "studentpass123"
    })
    assert resp.status_code == 403, f"Expected 403 Forbidden for deactivated user, got {resp.status_code}"
    print("  PASS: Deactivated student login correctly forbidden (403).")

    # 23. Admin deletes test student
    print(f"\n[Test 22] Admin deletes test student account...")
    resp = client.delete(f"/admin/users/{student_id}", headers=admin_headers)
    assert resp.status_code == 200
    print("  PASS: Student account deleted.")

    print("\n" + "=" * 60)
    print("ALL 22 QA TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
