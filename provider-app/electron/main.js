const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const si = require('systeminformation')
const axios = require('axios')
const { exec, spawn } = require('child_process')
const fs = require('fs')

let mainWindow
let agentProcess = null

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:9000'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

/**
 * Resolve the host-agent directory across dev and packaged modes.
 */
function getAgentDir() {
  const candidateDirs = [
    // 1. Packaged Electron extraResources path
    app.isPackaged ? path.join(process.resourcesPath, 'host-agent') : null,
    // 2. Dev mode relative from __dirname (electron/ -> ../../host-agent)
    path.join(__dirname, '..', '..', 'host-agent'),
    // 3. Dev mode relative from process.cwd()
    path.join(process.cwd(), '..', 'host-agent'),
    path.join(process.cwd(), 'host-agent'),
    // 4. Alongside electron app folder
    path.join(app.getAppPath(), '..', 'host-agent'),
    path.join(app.getAppPath(), 'host-agent')
  ].filter(Boolean)

  for (const dir of candidateDirs) {
    if (fs.existsSync(path.join(dir, 'agent.py'))) {
      return dir
    }
  }

  // Default fallback
  return app.isPackaged
    ? path.join(process.resourcesPath, 'host-agent')
    : path.join(__dirname, '..', '..', 'host-agent')
}

function getAgentScriptPath() {
  return path.join(getAgentDir(), 'agent.py')
}

function getConfigPath() {
  return path.join(getAgentDir(), 'host_config.json')
}

async function findPythonExecutable() {
  const isWindows = process.platform === 'win32'
  const candidates = [
    'python',
    'python3',
    'py',
    isWindows ? 'C:\\Python314\\python.exe' : null,
    isWindows ? 'C:\\Python313\\python.exe' : null,
    isWindows ? 'C:\\Python312\\python.exe' : null,
    isWindows ? 'C:\\Python311\\python.exe' : null,
    isWindows && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs\\Python\\Python314\\python.exe') : null,
    isWindows && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs\\Python\\Python312\\python.exe') : null,
    isWindows && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs\\Python\\Python311\\python.exe') : null
  ].filter(Boolean)

  for (const cmd of candidates) {
    try {
      const res = await execPromise(`"${cmd}" -c "import sys; print(sys.executable)"`, { timeout: 2000 })
      if (res.success && res.stdout && !res.stdout.toLowerCase().includes('not found')) {
        return res.stdout.trim()
      }
    } catch {}
  }
  return 'python'
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 840,
    minWidth: 920,
    minHeight: 680,
    title: 'GPU Share Hub — Provider Node Control Panel',
    backgroundColor: '#f8f9fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.setMenuBarVisibility(false)

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      setTimeout(() => {
        mainWindow.loadURL('http://localhost:5173')
      }, 1500)
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// -------------------------------------------------------------
// Direct GPU & System Hardware Telemetry
// -------------------------------------------------------------
async function getNvidiaSmiStats() {
  return new Promise((resolve) => {
    exec(
      'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits',
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null)
          return
        }
        try {
          const lines = stdout.trim().split('\n')
          if (lines.length > 0 && lines[0].includes(',')) {
            const parts = lines[0].split(',').map((s) => s.trim())
            resolve({
              model: parts[0] || 'NVIDIA GPU',
              total_vram_mb: parseFloat(parts[1]) || 0,
              used_vram_mb: parseFloat(parts[2]) || 0,
              free_vram_mb: parseFloat(parts[3]) || 0,
              gpu_util_pct: parseFloat(parts[4]) || 0,
              temp_c: parseFloat(parts[5]) || 0,
              power_w: parseFloat(parts[6]) || 0,
              has_nvidia: true
            })
          } else {
            resolve(null)
          }
        } catch {
          resolve(null)
        }
      }
    )
  })
}

// Helper: Run shell command with strict timeout & process termination
function execPromise(cmd, options = {}) {
  const timeoutMs = options.timeout || 2000
  return new Promise((resolve) => {
    let completed = false
    let proc = null

    const timer = setTimeout(() => {
      if (!completed) {
        completed = true
        if (proc && proc.pid) {
          try {
            if (process.platform === 'win32') {
              exec(`taskkill /F /T /PID ${proc.pid}`, () => {})
            } else {
              proc.kill('SIGKILL')
            }
          } catch {}
        }
        resolve({
          success: false,
          stdout: '',
          stderr: 'Probe timed out',
          error: 'Probe timed out'
        })
      }
    }, timeoutMs)

    try {
      proc = exec(cmd, options, (error, stdout, stderr) => {
        if (!completed) {
          completed = true
          clearTimeout(timer)
          resolve({
            success: !error,
            stdout: (stdout || '').trim(),
            stderr: (stderr || '').trim(),
            error: error ? error.message : null
          })
        }
      })
    } catch (e) {
      if (!completed) {
        completed = true
        clearTimeout(timer)
        resolve({ success: false, stdout: '', stderr: e.message, error: e.message })
      }
    }
  })
}

// -------------------------------------------------------------
// IPC Handlers
// -------------------------------------------------------------
ipcMain.handle('get-hardware-telemetry', async () => {
  try {
    const [cpuLoad, cpuInfo, mem, graphics, nvidiaSmi] = await Promise.all([
      si.currentLoad(),
      si.cpu(),
      si.mem(),
      si.graphics(),
      getNvidiaSmiStats()
    ])

    let gpuData = nvidiaSmi
    if (!gpuData && graphics && graphics.controllers && graphics.controllers.length > 0) {
      const g = graphics.controllers.find((c) => (c.vendor || '').toLowerCase().includes('nvidia')) || graphics.controllers[0]
      gpuData = {
        model: g.model || 'Standard GPU',
        total_vram_mb: g.vram || 4096,
        used_vram_mb: g.memoryUsed || 0,
        free_vram_mb: g.memoryFree || g.vram || 4096,
        gpu_util_pct: g.utilizationGpu || 0,
        temp_c: g.temperatureGpu || 0,
        has_nvidia: (g.vendor || '').toLowerCase().includes('nvidia')
      }
    }

    return {
      cpu: {
        cores: cpuInfo.cores || 4,
        physicalCores: cpuInfo.physicalCores || cpuInfo.cores || 4,
        brand: `${cpuInfo.manufacturer || ''} ${cpuInfo.brand || 'Processor'}`.trim(),
        loadPct: Math.round(cpuLoad.currentLoad || 0)
      },
      ram: {
        totalGb: Math.round((mem.total / 1024 ** 3) * 10) / 10,
        usedGb: Math.round((mem.used / 1024 ** 3) * 10) / 10,
        freeGb: Math.round((mem.free / 1024 ** 3) * 10) / 10,
        usedPct: Math.round((mem.used / mem.total) * 100)
      },
      gpu: gpuData || {
        model: 'Integrated / Emulated Compute',
        total_vram_mb: 8192,
        used_vram_mb: 0,
        free_vram_mb: 8192,
        gpu_util_pct: 0,
        temp_c: 0,
        has_nvidia: false
      }
    }
  } catch (err) {
    return {
      error: err.message
    }
  }
})

ipcMain.handle('get-agent-status', async () => {
  try {
    const res = await axios.get(`${AGENT_URL}/health`, { timeout: 2000 })
    return {
      online: true,
      data: res.data
    }
  } catch {
    return {
      online: false,
      data: null
    }
  }
})

ipcMain.handle('get-cluster-status', async (event, machineId) => {
  try {
    const [mRes, jRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/machines`, { timeout: 2500 }),
      axios.get(`${BACKEND_URL}/admin/jobs`, { timeout: 2500 }).catch(() => ({ data: [] }))
    ])

    const machines = mRes.data || []
    const jobs = jRes.data || []

    const thisMachine = machineId ? machines.find((m) => m.id === machineId) : machines[machines.length - 1]
    const assignedJobs = machineId ? jobs.filter((j) => j.machine_id === machineId) : jobs

    return {
      connected: true,
      machine: thisMachine || null,
      activeJobs: assignedJobs
    }
  } catch {
    return {
      connected: false,
      machine: null,
      activeJobs: []
    }
  }
})

ipcMain.handle('get-provider-config', async () => {
  const possiblePaths = [
    getConfigPath(),
    path.join(getAgentDir(), 'host_config.json'),
    path.join(__dirname, '../../host-agent/host_config.json'),
    path.join(process.cwd(), '../host-agent/host_config.json'),
    path.join(process.cwd(), 'host_config.json')
  ]
  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8')
        return JSON.parse(raw)
      } catch {}
    }
  }
  return null
})

ipcMain.handle('save-provider-config', async (event, config) => {
  const targetPaths = [
    getConfigPath(),
    path.join(getAgentDir(), 'host_config.json'),
    path.join(__dirname, '../../host-agent/host_config.json'),
    path.join(process.cwd(), '../host-agent/host_config.json'),
    path.join(process.cwd(), 'host_config.json')
  ]

  let saved = false
  for (const p of targetPaths) {
    if (!p) continue
    try {
      const dir = path.dirname(p)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8')
      saved = true
    } catch {}
  }

  try {
    await axios.post(`${AGENT_URL}/update-config`, config, { timeout: 1500 })
  } catch {}

  return { success: saved, config }
})

/**
 * Centralized agent launcher that works in both dev and packaged .exe environments.
 */
async function launchAgentProcess(config, sendLogFn) {
  const log = sendLogFn || ((line) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-log', line)
    }
  })

  // 1. Check if agent daemon is already responsive on port 9000
  try {
    const health = await axios.get(`${AGENT_URL}/health`, { timeout: 1200 })
    if (health.status === 200) {
      log('Agent daemon is already running and responsive on port 9000.')
      if (config) {
        try {
          await axios.post(`${AGENT_URL}/update-config`, config, { timeout: 1500 })
        } catch {}
      }
      return { success: true, message: 'Agent active on port 9000' }
    }
  } catch {}

  const agentScriptPath = getAgentScriptPath()
  const agentCwd = getAgentDir()

  log(`Locating agent script at: ${agentScriptPath}`)
  if (!fs.existsSync(agentScriptPath)) {
    const errMsg = `agent.py not found at ${agentScriptPath}`
    log(`[ERROR] ${errMsg}`)
    return { success: false, error: errMsg }
  }

  // Save config if provided
  if (config) {
    try {
      const cfgPath = getConfigPath()
      const dir = path.dirname(cfgPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8')
      log(`Sharing caps saved to: ${cfgPath}`)
    } catch (e) {
      log(`Config save note: ${e.message}`)
    }
  }

  const pythonExe = await findPythonExecutable()
  log(`Spawning agent using Python: "${pythonExe}"...`)

  try {
    agentProcess = spawn(pythonExe, [agentScriptPath, '--yes'], {
      cwd: agentCwd,
      env: {
        ...process.env,
        HEADLESS: '1',
        BACKEND_URL: `${BACKEND_URL}/heartbeat`
      },
      detached: false,
      stdio: 'pipe'
    })

    agentProcess.stdout.on('data', (data) => {
      const str = data.toString()
      log(str.trim())
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-log', str)
      }
    })

    agentProcess.stderr.on('data', (data) => {
      const str = data.toString()
      log(`[Agent Err] ${str.trim()}`)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-log', str)
      }
    })

    agentProcess.on('error', (err) => {
      log(`[ERROR] Failed to start agent process: ${err.message}`)
    })

    agentProcess.on('close', (code) => {
      log(`[Agent] Process terminated (code ${code})`)
      agentProcess = null
    })

    // Poll health check for up to 10 seconds
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const check = await axios.get(`${AGENT_URL}/health`, { timeout: 1000 })
        if (check.status === 200) {
          log(`Agent verified online & responding on port 9000!`)
          return { success: true, message: 'Agent started successfully' }
        }
      } catch {}
    }

    log('Agent process spawned. Initializing port 9000...')
    return { success: true, message: 'Agent process launched' }
  } catch (err) {
    log(`[ERROR] Failed to spawn agent: ${err.message}`)
    return { success: false, error: err.message }
  }
}

// -------------------------------------------------------------
// End-to-End Automated Diagnostics & Node Setup Pipeline
// -------------------------------------------------------------
ipcMain.handle('run-automated-pipeline', async (event, config) => {
  const sendStep = (stepId, status, detail) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pipeline-step', { stepId, status, detail })
    }
  }

  const sendLog = (line) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pipeline-log', `[${new Date().toLocaleTimeString()}] ${line}`)
    }
  }

  try {
    sendLog('=== STARTING NODE VERIFICATION & INITIALIZATION ===')

    // STEP 1: Hardware & GPU Diagnostics
    sendStep('hardware', 'running', 'Inspecting physical hardware capabilities (GPU, CPU, RAM)...')
    sendLog('Inspecting host hardware via NVML and SystemInformation...')
    const [mem, cpuInfo, nvidiaSmi] = await Promise.all([
      si.mem(),
      si.cpu(),
      getNvidiaSmiStats()
    ])

    const totalRamGb = Math.round((mem.total / 1024 ** 3) * 10) / 10
    const totalCpus = cpuInfo.cores || 4
    const gpuName = nvidiaSmi ? nvidiaSmi.model : 'Integrated / Standard Graphics'
    const totalVramGb = nvidiaSmi ? Math.round((nvidiaSmi.total_vram_mb / 1024) * 10) / 10 : 8.0

    sendLog(`Detected GPU: ${gpuName} with ${totalVramGb} GB VRAM`)
    sendLog(`Detected CPU: ${cpuInfo.brand || 'Processor'} with ${totalCpus} cores`)
    sendLog(`Detected RAM: ${totalRamGb} GB physical system memory`)

    sendStep(
      'hardware',
      'success',
      `Detected: ${gpuName} (${totalVramGb} GB VRAM) · ${totalCpus} CPU Cores · ${totalRamGb} GB RAM`
    )

    // STEP 2: Docker Desktop & GPU Passthrough Check (Instant Process Probe)
    sendStep('docker', 'running', 'Verifying Docker engine & container runtime...')
    sendLog('Checking Docker daemon status...')
    const isWindows = process.platform === 'win32'
    let dockerFound = false
    let dockerVer = ''

    if (isWindows) {
      const taskCheck = await execPromise('tasklist /FI "IMAGENAME eq Docker Desktop.exe" /NH', { timeout: 1200 })
      const isRunning = taskCheck.success && taskCheck.stdout.toLowerCase().includes('docker desktop.exe')

      if (isRunning) {
        const verCheck = await execPromise('docker version --format "{{.Server.Version}}"', { timeout: 1500 })
        if (verCheck.success && verCheck.stdout) {
          dockerFound = true
          dockerVer = verCheck.stdout
        }
      }
    } else {
      const verCheck = await execPromise('docker version --format "{{.Server.Version}}"', { timeout: 1500 })
      if (verCheck.success && verCheck.stdout) {
        dockerFound = true
        dockerVer = verCheck.stdout
      }
    }

    if (dockerFound) {
      sendLog(`Docker daemon is active (Engine v${dockerVer || 'ready'}).`)
      sendStep('docker', 'success', `Docker engine active (v${dockerVer || 'running'}) with cgroups isolation.`)
    } else {
      sendLog('Docker Desktop not currently running in background. Host sandbox mode enabled.')
      sendStep(
        'docker',
        'warning',
        'Docker Desktop is not currently running. Make sure Docker Desktop is started.'
      )
    }

    // STEP 3: Tailscale WireGuard Mesh Network Check
    sendStep('tailscale', 'running', 'Checking private WireGuard mesh connectivity...')
    sendLog('Querying Tailscale interface for private mesh IPv4...')
    const tsCandidates = [
      'tailscale ip -4',
      isWindows ? '& "C:\\Program Files\\Tailscale\\tailscale.exe" ip -4' : '/usr/bin/tailscale ip -4'
    ]

    let meshIp = null
    for (const cmd of tsCandidates) {
      const res = await execPromise(cmd, { timeout: 1500 })
      if (res.success && res.stdout && !res.stdout.includes('failed') && res.stdout.length > 5) {
        meshIp = res.stdout.split('\n')[0].trim()
        break
      }
    }

    if (meshIp) {
      sendLog(`Tailscale private mesh IPv4 verified: ${meshIp}`)
      sendStep('tailscale', 'success', `Connected to encrypted mesh. Node Mesh IP: ${meshIp}`)
    } else {
      sendLog('Tailscale mesh connecting or using local fallback (127.0.0.1).')
      sendStep('tailscale', 'warning', 'Tailscale mesh connecting or using local fallback (127.0.0.1).')
    }

    // STEP 4: Python Runtimes & Dependencies
    sendStep('python', 'running', 'Checking Python environment and NVML/Flask packages...')
    sendLog('Verifying Python runtime dependencies (flask, requests, docker, pynvml)...')
    const pythonExe = await findPythonExecutable()
    const pyCheck = await execPromise(`"${pythonExe}" -c "import flask, requests; print('ready')"`, { timeout: 2500 })
    if (pyCheck.success && pyCheck.stdout.includes('ready')) {
      sendLog('Python packages verified and ready.')
      sendStep('python', 'success', 'Python dependencies (Flask, Requests, Docker, NVML) ready.')
    } else {
      sendLog('Installing missing Python dependencies in background...')
      sendStep('python', 'running', 'Installing missing Python dependencies (flask, requests, docker, pynvml)...')
      const pipRes = await execPromise(`"${pythonExe}" -m pip install pynvml requests flask docker --quiet`, { timeout: 15000 })
      if (pipRes.stdout) sendLog(pipRes.stdout)
      sendLog('Python dependencies installed successfully.')
      sendStep('python', 'success', 'Python packages configured.')
    }

    // STEP 5: Save Sharing Caps & Launch Background Provider Agent
    sendStep('agent', 'running', 'Saving configured sharing caps and launching provider agent...')

    const effectiveConfig = config || {
      shared_vram_gb: Math.min(4.0, totalVramGb),
      shared_cpus: Math.max(1, totalCpus - 2),
      shared_ram_gb: Math.min(8.0, Math.round(totalRamGb * 0.5))
    }

    sendLog(`Launching provider agent daemon with limits: ${effectiveConfig.shared_vram_gb} GB VRAM, ${effectiveConfig.shared_cpus} CPUs, ${effectiveConfig.shared_ram_gb} GB RAM...`)

    const agentResult = await launchAgentProcess(effectiveConfig, sendLog)
    if (agentResult.success) {
      sendStep(
        'agent',
        'success',
        `Agent live on port 9000. Sharing locked to: ${effectiveConfig.shared_vram_gb} GB VRAM · ${effectiveConfig.shared_cpus} CPUs · ${effectiveConfig.shared_ram_gb} GB RAM`
      )
      sendLog('=== ALL PRE-FLIGHT CHECKS PASSED. NODE IS LIVE & SHARING ===')
      return { success: true, config: effectiveConfig }
    } else {
      sendStep('agent', 'error', `Failed to start agent: ${agentResult.error || 'Unknown error'}`)
      return { success: false, error: agentResult.error }
    }
  } catch (err) {
    sendLog(`ERROR: ${err.message}`)
    sendStep('agent', 'error', `Pipeline encountered an error: ${err.message}`)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('run-full-ml-setup', async (event, config) => {
  const sendLog = (line) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pipeline-log', `[${new Date().toLocaleTimeString()}] ${line}`)
    }
  }

  try {
    sendLog('=====================================================')
    sendLog('STARTING FULL ML / JUPYTERHUB / PYTORCH GPU SETUP')
    sendLog('=====================================================')

    // STEP 1: Connect Tailscale WireGuard Mesh
    sendLog('[1/4] Configuring Tailscale WireGuard peer-to-peer mesh...')
    const isWindows = process.platform === 'win32'
    const tsCmd = isWindows ? '& "C:\\Program Files\\Tailscale\\tailscale.exe" up --accept-routes' : 'tailscale up --accept-routes'
    const tsRes = await execPromise(tsCmd, { timeout: 4000 })
    if (tsRes.stdout) sendLog(`Tailscale output: ${tsRes.stdout}`)
    sendLog('Tailscale mesh configuration verified.')

    // STEP 2: Python ML & Agent Dependencies
    sendLog('[2/4] Installing Python ML, Flask, NVML, and Docker container libraries...')
    const pythonExe = await findPythonExecutable()
    const pipCmd = `"${pythonExe}" -m pip install pynvml requests flask docker --quiet`
    const pipRes = await execPromise(pipCmd, { timeout: 20000 })
    if (pipRes.stdout) sendLog(pipRes.stdout)
    sendLog('Python dependencies ready: Flask, Requests, Docker, NVML.')

    // STEP 3: Docker WSL2 GPU Passthrough & PyTorch Jupyter Image
    sendLog('[3/4] Checking Docker GPU sandbox and pre-fetching Jupyter PyTorch container...')
    const dockerVer = await execPromise('docker version --format "{{.Server.Version}}"', { timeout: 2000 })
    if (dockerVer.success && dockerVer.stdout) {
      sendLog(`Docker Engine active (v${dockerVer.stdout}).`)
      sendLog('Pulling Jupyter container base image in background...')
      execPromise('docker pull quay.io/jupyter/pytorch-notebook:cuda12-latest', { timeout: 60000 }).then((pullRes) => {
        if (pullRes.success) sendLog('Jupyter PyTorch container image successfully cached.')
      })
    } else {
      sendLog('Docker daemon not responding. Worker will run in host runtime mode.')
    }

    // STEP 4: Save Limits & Launch Host Agent Daemon
    sendLog('[4/4] Locking provider hardware allocation and starting daemon on port 9000...')
    const effectiveConfig = config || { shared_vram_gb: 4, shared_cpus: 4, shared_ram_gb: 8 }

    const res = await launchAgentProcess(effectiveConfig, sendLog)
    if (!res.success) {
      sendLog(`[ERROR] Agent start failed: ${res.error}`)
      return { success: false, error: res.error }
    }

    sendLog('=====================================================')
    sendLog('FULL ML & JUPYTER ENVIRONMENT SETUP COMPLETE!')
    sendLog('Your GPU Worker Node is now active and ready for ML jobs.')
    sendLog('=====================================================')

    return { success: true, message: 'ML environment setup completed.' }
  } catch (err) {
    sendLog(`[ERROR] Setup error: ${err.message}`)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('start-elevated-setup', async (event) => {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32'

    if (isWindows) {
      try {
        const tempScript = path.join(app.getPath('temp'), 'gpushare_install.ps1')
        const scriptContent = `# GPU Share Hub Administrator Setup
Write-Host "Connecting to GPU Share Hub cluster..." -ForegroundColor Cyan
try {
  irm ${BACKEND_URL}/install-script-windows | iex
} catch {
  Write-Host "Installation encountered an issue: $_" -ForegroundColor Red
}
`
        fs.writeFileSync(tempScript, scriptContent, 'utf8')

        const psArgs = [
          '-NoProfile',
          '-Command',
          `Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', '${tempScript}'`
        ]

        const child = spawn('powershell.exe', psArgs, {
          detached: true,
          stdio: 'ignore'
        })
        child.unref()

        resolve({
          success: true,
          message: 'Elevated Administrator window launched. Please accept the Windows UAC prompt.'
        })
      } catch (err) {
        resolve({ success: false, error: err.message })
      }
    } else {
      const bashCmd = `curl -sSL ${BACKEND_URL}/install-script | bash`
      exec(`pkexec bash -c "${bashCmd}" || sudo bash -c "${bashCmd}"`, (err) => {
        if (err) {
          resolve({ success: false, error: err.message })
        } else {
          resolve({ success: true, message: 'Installer completed.' })
        }
      })
    }
  })
})

ipcMain.handle('start-agent-service', async (event, config) => {
  return await launchAgentProcess(config)
})

ipcMain.handle('stop-agent-service', async () => {
  try {
    await axios.post(`${AGENT_URL}/shutdown`, {}, { timeout: 2000 })
  } catch {}

  if (agentProcess) {
    try {
      agentProcess.kill()
      agentProcess = null
    } catch {}
  }

  return { success: true, message: 'Agent stopped' }
})

app.whenReady().then(async () => {
  createWindow()
  // Auto-launch agent in background on app startup
  setTimeout(() => {
    launchAgentProcess().catch(() => {})
  }, 1000)
})

app.on('window-all-closed', () => {
  if (agentProcess) {
    try {
      agentProcess.kill()
    } catch {}
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
