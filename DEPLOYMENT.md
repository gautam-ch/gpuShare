# 🌍 Deployment Guide — GPU Share Hub (Worldwide Access)

## Architecture Overview

```
User (anywhere) ──→ Vercel (frontend) ──→ Railway (backend + PostgreSQL)
                                                 │
GPU Host (anywhere) ──→ Tailscale Tailnet ───────┘
                               │
                    Cloudflare Tunnel (public HTTPS)
                               │
                    Jupyter container on host machine
                               │
User accesses Jupyter ────────→ Public URL (no Tailscale needed for renter)
```

> [!IMPORTANT]
> The renter does NOT need Tailscale. Only the GPU host needs it.
> Cloudflare Tunnel makes the Jupyter session publicly accessible via a secure HTTPS URL.

---

## Phase 1: Deploy the Backend to Railway

Railway gives you a free PostgreSQL database and a public HTTPS URL.

### Step 1: Sign up and install Railway CLI
```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
```

### Step 2: Create a new Railway project
Go to https://railway.app → New Project → Empty Project

### Step 3: Add PostgreSQL
In Railway dashboard → New Service → Database → PostgreSQL
Copy the `DATABASE_URL` from the Variables tab.

### Step 4: Deploy backend
```bash
cd D:\btp1\backend

# Initialize Railway project
railway init

# Set environment variables in Railway dashboard:
# DATABASE_URL = (from PostgreSQL service)
# TAILSCALE_AUTHKEY = tskey-auth-kYourKey
# BACKEND_PUBLIC_URL = https://your-app.railway.app  (Railway gives you this)

# Deploy
railway up
```

### Step 5: Add a Procfile to the backend
Create `d:\btp1\backend\Procfile`:
```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

### Step 6: Update database.py for Railway's PostgreSQL
Railway's DATABASE_URL uses `postgresql://`, SQLAlchemy needs `postgresql+psycopg2://`.
The backend already handles this — just set `DATABASE_URL` env var.

---

## Phase 2: Deploy the Frontend to Vercel

Vercel is free and deploys Next.js in seconds.

### Step 1: Sign up and install Vercel CLI
```bash
npm install -g vercel
vercel login
```

### Step 2: Deploy
```bash
cd D:\btp1\frontend

# Set environment variables:
# NEXT_PUBLIC_BACKEND_URL = https://your-app.railway.app

vercel --prod
```

Vercel gives you a public URL like `https://gpu-share-hub.vercel.app`.

---

## Phase 3: Solve the Jupyter Access Problem

> [!IMPORTANT]
> This is the key challenge: The GPU host is behind NAT. 
> The renter (anywhere in world) needs to access Jupyter on the host.
> Tailscale handles host→backend communication, but NOT renter→host.
> 
> **Solution: Cloudflare Tunnel** — creates a public HTTPS URL for the Jupyter container.
> Free, no port forwarding, no static IP needed.

### How it works
When the host agent starts a Jupyter container, it ALSO runs:
```bash
cloudflared tunnel --url http://localhost:8888
```
This creates a URL like `https://random-words.trycloudflare.com` that anyone can open.
The host agent sends this URL back to the backend, which returns it to the renter.

---

## Phase 4: Update Host Agent for Cloudflare Tunnel

The updated agent already handles this — when Jupyter starts, it also:
1. Downloads `cloudflared` (Cloudflare's tunnel binary)
2. Starts a quick tunnel (`--url` mode — no account needed)
3. Parses the public URL from the output
4. Returns it to the backend

No account needed for quick tunnels (free, works for hours).

---

## Phase 5: Configure Tailscale for Production

### Get a Reusable Pre-Auth Key
1. Go to https://login.tailscale.com/admin/settings/keys
2. Create a key with:
   - ✅ Reusable (many hosts can use the same key)
   - ✅ Ephemeral (auto-removes offline machines)
3. Set it as `TAILSCALE_AUTHKEY` env var in Railway

### The Tailnet
- Your backend (Railway) joins the Tailnet OR uses the Tailscale API to manage machines
- Each GPU host joins the Tailnet via the auto-installer
- Backend communicates with hosts via their Tailscale IPs

---

## Complete Environment Variables Reference

### Railway Backend
| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host/db` | PostgreSQL connection |
| `TAILSCALE_AUTHKEY` | `tskey-auth-k...` | Auto-connect hosts to Tailnet |
| `BACKEND_PUBLIC_URL` | `https://your-app.railway.app` | Used in install scripts |
| `PORT` | Set by Railway automatically | HTTP port |

### Vercel Frontend
| Variable | Value | Purpose |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `https://your-app.railway.app` | API calls from browser |

---

## Final User Flow (After Deployment)

### GPU Host (your friend, or anyone worldwide)
1. Visit `https://gpu-share-hub.vercel.app/host`
2. Copy ONE command (auto-generated with your Railway backend URL)
3. Paste in terminal → everything installs automatically
4. Machine appears on the platform ✅

### GPU Renter (anyone in the world)
1. Visit `https://gpu-share-hub.vercel.app`
2. Enter required VRAM (e.g., 4 GB)
3. Click **Rent GPU** → get a token + access URL
4. Click **Launch Jupyter** → Cloudflare public URL opens
5. Full JupyterLab in the browser — GPU-accelerated ✅

---

## Cost Estimate

| Service | Free Tier | Cost After Free |
|---|---|---|
| **Vercel** (frontend) | Unlimited deployments | $0/month for hobby |
| **Railway** (backend) | $5 credit/month | ~$5-10/month |
| **PostgreSQL** (Railway) | 1GB included | Included |
| **Tailscale** | 3 users / 100 devices free | $6/user/month after |
| **Cloudflare Tunnel** | Unlimited (quick tunnels) | $0 |

**Total: ~$0-10/month** for a fully functional worldwide GPU sharing platform.

---

## Quick Start Commands

```bash
# 1. Install CLIs
npm install -g @railway/cli vercel

# 2. Deploy backend
cd D:\btp1\backend
railway login && railway init && railway up

# 3. Deploy frontend (after setting NEXT_PUBLIC_BACKEND_URL in Vercel dashboard)
cd D:\btp1\frontend
vercel --prod
```
