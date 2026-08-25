# GPU Share Hub — Provider Desktop Control Panel

A native desktop application built with **Electron, React (Vite + JavaScript), and Tailwind CSS** for GPU providers to monitor real-time hardware telemetries, sharing limits, and active renter container workloads.

## Features
- **GPU VRAM & Core Telemetry**: Real-time VRAM allocation, Core utilization %, temperature, and live "In Use" vs "Available" status.
- **CPU & RAM Monitoring**: Physical cores, shared core caps, system memory usage vs shared limits.
- **Active Workloads Table**: Live tracking of running Jupyter container pods (`jupyter-*`), allocated slices, and session duration.
- **Node Mesh Status**: Node ID, WireGuard Tailscale IP, and heartbeat connection to the cluster.
- **JupyterHub Aesthetic**: Clean white background, high-contrast dark text, Jupyter orange accents, and zero emojis.

## Development & Running

1. **Install Dependencies**:
   ```bash
   cd provider-app
   npm install
   ```

2. **Start in Desktop App Mode (Electron + Vite Live Reload)**:
   ```bash
   npm run electron:dev
   ```

3. **Start in Web Browser Preview Mode**:
   ```bash
   npm run dev
   ```

4. **Build Production Bundle**:
   ```bash
   npm run build
   ```
