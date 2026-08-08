# How to Make Tailscale Fully Automatic (Pre-Auth Key Setup)

## The Problem Without a Pre-Auth Key
Without an auth key, Tailscale opens a browser tab on the HOST machine asking them to log in.
That's one manual step we want to eliminate.

## The Solution: Pre-Auth Key
A **pre-auth key** is a token you generate from your Tailscale account once.
The install script uses it to connect the host machine automatically — no browser, no login.

## Step 1: Generate a Key (You do this ONCE)
1. Go to https://login.tailscale.com/admin/settings/keys
2. Click **"Generate auth key"**
3. Check **"Reusable"** (so multiple friends can use it)
4. Check **"Ephemeral"** optional (machines auto-remove after going offline)
5. Copy the key — it looks like: `tskey-auth-kSomeRandomString123`

## Step 2: Set the Environment Variable Before Running Backend

### Windows (PowerShell)
```powershell
$env:TAILSCALE_AUTHKEY = "tskey-auth-kSomeRandomString123"
$env:BACKEND_PUBLIC_URL = "http://100.x.x.x:8000"   # your Tailscale IP
uvicorn main:app --reload
```

### Linux / Mac
```bash
TAILSCALE_AUTHKEY="tskey-auth-kSomeRandomString123" \
BACKEND_PUBLIC_URL="http://100.x.x.x:8000" \
uvicorn main:app --reload
```

## Step 3: What Happens Now
When your friend opens `http://<your-tailscale-ip>:3000/host`, they see:
1. ONE command to copy
2. They paste it in their terminal
3. Tailscale installs and connects AUTOMATICALLY (no browser popup)
4. Agent downloads and starts
5. Your website automatically shows "🎉 Your machine is live!"

## BACKEND_PUBLIC_URL — Which IP to use?

| Scenario | Use |
|---|---|
| Both on same WiFi | Your local IP: `ipconfig` → `192.168.x.x` |
| Different networks (hostel) | Your Tailscale IP: `tailscale ip -4` → `100.x.x.x` |
| Deployed server | Your server's public IP or domain |

For hostel scenario: **use your Tailscale IP** as BACKEND_PUBLIC_URL.
This way, after Tailscale is installed on the host machine, it can reach the backend through the Tailnet.
