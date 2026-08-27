"use client"
import { useState, useEffect } from 'react'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

interface Preset {
  id: string
  name: string
  badge: string
  vram: number
  cpus: number
  ram: number
  desc: string
  workloads: string[]
}

interface Machine {
  id: string
  tailscale_ip: string
  vram_total_mb: number
  vram_free_mb: number
  cpus: number
  status: string
}

const PRESETS: Preset[] = [
  {
    id: 'starter',
    name: 'Intro ML & Data Science',
    badge: 'Standard Tier',
    vram: 2,
    cpus: 2,
    ram: 4,
    desc: 'Lightweight experimentation, Pandas/NumPy data cleaning, Scikit-learn models & basic PyTorch tensors.',
    workloads: ['Tabular ML (XGBoost / LightGBM)', 'Data Preprocessing & EDA', 'Intro PyTorch / TF Tutorials']
  },
  {
    id: 'vision',
    name: 'Computer Vision & CNNs',
    badge: 'Recommended',
    vram: 4,
    cpus: 4,
    ram: 8,
    desc: 'Image classification, object detection (YOLO), PyTorch custom training pipelines, and moderate batch sizes.',
    workloads: ['YOLOv8 / ResNet Training', 'OpenCV Image Pipelines', 'PyTorch CNNs with DataLoader Workers']
  },
  {
    id: 'deeplearning',
    name: 'Deep Learning & GenAI',
    badge: 'High Performance',
    vram: 8,
    cpus: 6,
    ram: 16,
    desc: 'Transformer architectures, Stable Diffusion image generation, Whisper speech transcription, and LoRA fine-tuning.',
    workloads: ['Stable Diffusion / Image Gen', 'LoRA / QLoRA Fine-tuning', 'Whisper Audio Transcription']
  }
]

export default function RentForm() {
  const [selectedPreset, setSelectedPreset] = useState<string>('vision')
  const [vram, setVram] = useState<number>(4)
  const [cpuCores, setCpuCores] = useState<number>(4)
  const [ramGb, setRamGb] = useState<number>(8)
  const [showGuide, setShowGuide] = useState<boolean>(false)

  const [onlineMachines, setOnlineMachines] = useState<Machine[]>([])
  const [maxAvailableVram, setMaxAvailableVram] = useState<number | null>(null)
  const [maxAvailableCpus, setMaxAvailableCpus] = useState<number | null>(null)
  const [maxAvailableRam, setMaxAvailableRam] = useState<number | null>(null)

  const [message, setMessage] = useState('')
  const [token, setToken] = useState('')
  const [jupyterUrl, setJupyterUrl] = useState('')
  const [loading, setLoading] = useState(false)

  // Fetch online capacity
  useEffect(() => {
    const checkCapacity = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/machines`)
        if (res.ok) {
          const data: Machine[] = await res.json()
          const live = data.filter((m: Machine & { shared_ram_gb?: number }) => m.status === 'online')
          setOnlineMachines(live)
          if (live.length > 0) {
            const maxV = Math.max(...live.map((m: Machine) => (m.vram_free_mb || 0) / 1024))
            const maxC = Math.max(...live.map((m: Machine) => m.cpus || 0))
            const maxR = Math.max(...live.map((m: Machine & { shared_ram_gb?: number }) => m.shared_ram_gb || 0))
            const roundedMaxV = Math.floor(maxV * 10) / 10
            setMaxAvailableVram(roundedMaxV)
            setMaxAvailableCpus(maxC)
            setMaxAvailableRam(maxR > 0 ? maxR : null)

            // Auto-clamp current selections to provider limits (functional update = always fresh state)
            if (roundedMaxV > 0) setVram(prev => Math.min(prev, roundedMaxV))
            if (maxC > 0) setCpuCores(prev => Math.min(prev, maxC))
            if (maxR > 0) setRamGb(prev => Math.min(prev, maxR))
          }
        }
      } catch (e) {
        console.error('Failed to fetch machines:', e)
      }
    }
    checkCapacity()
    const interval = setInterval(checkCapacity, 10000)
    return () => clearInterval(interval)
  }, [])

  const applyPreset = (preset: Preset) => {
    setSelectedPreset(preset.id)
    setVram(preset.vram)
    setCpuCores(preset.cpus)
    setRamGb(preset.ram)
  }

  const handleCustomChange = (type: 'vram' | 'cpu' | 'ram', val: number) => {
    setSelectedPreset('custom')
    if (type === 'vram') setVram(val)
    if (type === 'cpu') setCpuCores(val)
    if (type === 'ram') setRamGb(val)
  }

  const handleRent = async () => {
    setLoading(true)
    setMessage('')
    try {
      const res = await fetch(`${BACKEND_URL}/rent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vram_required: vram,
          cpu_cores: cpuCores,
          ram_gb: ramGb,
          cpus_required: cpuCores
        })
      })
      const data = await res.json()
      if (res.ok) {
        setToken(data.access_token)
        setJupyterUrl(data.jupyter_url)
        setMessage(`Server allocated successfully! Launch your workspace below.`)
      } else {
        setMessage(`Failed: ${data.detail || 'Something went wrong'}`)
      }
    } catch (e) {
      setMessage('Could not connect to the cluster controller. Ensure the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  const handleLaunch = () => {
    if (!token) return
    window.location.href = `/jupyter?token=${token}`
  }

  const isOverVram = maxAvailableVram !== null && vram > maxAvailableVram
  const isOverCpu = maxAvailableCpus !== null && cpuCores > maxAvailableCpus
  const isOverRam = maxAvailableRam !== null && ramGb > maxAvailableRam

  return (
    <section className="space-y-8 pb-12 max-w-5xl mx-auto">
      {/* Rent Header Card */}
      <div className="bg-white border border-gray-200/80 rounded-xl p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              Rent GPU Environment
            </h1>
            <p className="text-gray-600 text-sm mt-1 max-w-2xl">
              Select your workload profile or customize dedicated compute resources for your JupyterLab workspace.
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end bg-gray-50 border border-gray-200/80 rounded-lg p-3.5 shrink-0">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${onlineMachines.length > 0 ? 'bg-emerald-500 shadow-xs' : 'bg-gray-400'}`}></span>
              <span className="text-xs font-semibold text-gray-800">
                {onlineMachines.length > 0 ? `${onlineMachines.length} Node${onlineMachines.length > 1 ? 's' : ''} Online` : 'No Nodes Detected'}
              </span>
            </div>
            <div className="text-xs text-gray-500 mt-1 font-mono">
              Max Free VRAM: {maxAvailableVram !== null ? `${maxAvailableVram} GB` : '—'}
            </div>
          </div>
        </div>

        {/* Section 1: Pre-configured Profiles */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
              <span>1. Choose Workload Profile</span>
            </h2>
            <button
              type="button"
              onClick={() => setShowGuide(!showGuide)}
              className="text-xs text-[#bb432c] hover:text-[#9c3622] hover:underline font-medium flex items-center gap-1 cursor-pointer"
            >
              {showGuide ? 'Hide Sizing Guide' : 'Sizing Guide & Workload Help'}
            </button>
          </div>

          {/* Sizing Guide */}
          {showGuide && (
            <div className="bg-gray-50 border border-gray-200/80 rounded-lg p-4 text-xs space-y-3">
              <div className="font-semibold text-gray-900 text-sm">
                Resource Allocation Guide
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-gray-700">
                <div className="bg-white p-3 rounded-md border border-gray-200 space-y-1">
                  <div className="font-bold text-[#bb432c]">GPU VRAM</div>
                  <p className="text-gray-600 leading-relaxed">
                    Determines model architecture and batch sizes in video memory.
                  </p>
                  <ul className="list-disc list-inside text-gray-500 text-[11px] space-y-0.5 pt-1">
                    <li><strong>2-4 GB:</strong> ResNet, Tabular, YOLOv8</li>
                    <li><strong>6-8 GB:</strong> Stable Diffusion, Whisper</li>
                    <li><strong>12+ GB:</strong> Quantized LLMs, LoRA Fine-tuning</li>
                  </ul>
                </div>

                <div className="bg-white p-3 rounded-md border border-gray-200 space-y-1">
                  <div className="font-bold text-gray-800">CPU Cores</div>
                  <p className="text-gray-600 leading-relaxed">
                    Runs preprocessing, tokenization, & DataLoader workers.
                  </p>
                  <ul className="list-disc list-inside text-gray-500 text-[11px] space-y-0.5 pt-1">
                    <li><strong>2 Cores:</strong> Standard notebooks</li>
                    <li><strong>4 Cores:</strong> Parallel image batches</li>
                    <li><strong>8 Cores:</strong> High-throughput streaming</li>
                  </ul>
                </div>

                <div className="bg-white p-3 rounded-md border border-gray-200 space-y-1">
                  <div className="font-bold text-gray-800">System RAM</div>
                  <p className="text-gray-600 leading-relaxed">
                    Stores in-memory datasets and DataFrames before GPU transfer.
                  </p>
                  <ul className="list-disc list-inside text-gray-500 text-[11px] space-y-0.5 pt-1">
                    <li><strong>4 GB:</strong> CSV / small datasets</li>
                    <li><strong>8 GB:</strong> Image folders, NumPy arrays</li>
                    <li><strong>16+ GB:</strong> Heavy video / NLP datasets</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Preset Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {PRESETS.map(preset => {
              const isSelected = selectedPreset === preset.id
              const exceeds = maxAvailableVram !== null && preset.vram > maxAvailableVram
              return (
                <div
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className={`p-4 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between relative ${
                    isSelected
                      ? 'bg-[#bb432c]/5 border-[#bb432c] ring-1 ring-[#bb432c] shadow-xs'
                      : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/60'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-gray-900 text-sm">{preset.name}</span>
                      <input
                        type="radio"
                        name="preset"
                        checked={isSelected}
                        onChange={() => applyPreset(preset)}
                        className="text-[#bb432c] focus:ring-[#bb432c] h-4 w-4 accent-[#bb432c]"
                      />
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-[11px] font-medium text-gray-700">
                        {preset.badge}
                      </span>
                      {exceeds && (
                        <span className="px-2 py-0.5 bg-amber-50 border border-amber-300 text-amber-800 rounded text-[10px] font-medium">
                          Exceeds live capacity
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-3">
                      {preset.desc}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs font-mono text-gray-700">
                    <span className="font-bold text-[#bb432c]">{preset.vram} GB VRAM</span>
                    <span>{preset.cpus} CPUs</span>
                    <span>{preset.ram} GB RAM</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Section 2: Custom Resource Sliders */}
        <div className="mt-8 pt-6 border-t border-gray-200 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
              2. Custom Hardware Configuration
            </h2>
            {selectedPreset === 'custom' && (
              <span className="px-2 py-0.5 bg-gray-100 border border-gray-300 text-gray-700 text-xs font-semibold rounded">
                Custom Selection
              </span>
            )}
          </div>

          {/* VRAM Controls */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <div className="font-semibold text-gray-800 flex items-center gap-2">
                <span>GPU Memory (VRAM)</span>
              </div>
              <span className="px-2.5 py-0.5 bg-gray-100 border border-gray-300 rounded font-mono font-bold text-gray-900 text-sm">
                {vram} GB
              </span>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {[1, 2, 4, 6, 8, 12].map(v => {
                const isDisabled = maxAvailableVram !== null && v > maxAvailableVram
                const active = vram === v
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => !isDisabled && handleCustomChange('vram', v)}
                    className={`py-2 text-xs font-mono font-bold rounded-lg border transition-colors ${
                      active
                        ? 'bg-[#bb432c] text-white border-[#bb432c] shadow-xs'
                        : isDisabled
                        ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer'
                    }`}
                  >
                    {v} GB
                    {isDisabled && <span className="block text-[9px] font-sans font-normal text-gray-400">Over cap</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* CPU Controls */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <div className="font-semibold text-gray-800 flex items-center gap-2">
                <span>CPU Allocation</span>
              </div>
              <span className="px-2.5 py-0.5 bg-gray-100 border border-gray-300 rounded font-mono font-bold text-gray-900 text-sm">
                {cpuCores} {cpuCores === 1 ? 'Core' : 'Cores'}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 4, 6, 8].map(c => {
                const isDisabled = maxAvailableCpus !== null && c > maxAvailableCpus
                const active = cpuCores === c
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => !isDisabled && handleCustomChange('cpu', c)}
                    className={`py-2 text-xs font-mono font-bold rounded-lg border transition-colors ${
                      active
                        ? 'bg-gray-900 text-white border-gray-900 shadow-xs'
                        : isDisabled
                        ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer'
                    }`}
                  >
                    {c} {c === 1 ? 'Core' : 'Cores'}
                    {isDisabled && <span className="block text-[9px] font-sans font-normal text-gray-400">Over cap</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* System Memory Controls */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <div className="font-semibold text-gray-800 flex items-center gap-2">
                <span>System Memory (RAM)</span>
              </div>
              <span className="px-2.5 py-0.5 bg-gray-100 border border-gray-300 rounded font-mono font-bold text-gray-900 text-sm">
                {ramGb} GB
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {[2, 4, 8, 12, 16].map(r => {
                const isDisabled = maxAvailableRam !== null && r > maxAvailableRam
                const active = ramGb === r
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => !isDisabled && handleCustomChange('ram', r)}
                    className={`py-2 text-xs font-mono font-bold rounded-lg border transition-colors ${
                      active
                        ? 'bg-gray-900 text-white border-gray-900 shadow-xs'
                        : isDisabled
                        ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer'
                    }`}
                  >
                    {r} GB
                    {isDisabled && <span className="block text-[9px] font-sans font-normal text-gray-400">Over cap</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Capacity Alert */}
          {(isOverVram || isOverCpu || isOverRam) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-amber-800">
              <div>
                <strong>Warning:</strong> Selection exceeds provider limits (Max: {maxAvailableVram} GB VRAM · {maxAvailableCpus} CPUs · {maxAvailableRam} GB RAM).
              </div>
              <button
                type="button"
                onClick={() => {
                  if (maxAvailableVram) setVram(maxAvailableVram)
                  if (maxAvailableCpus) setCpuCores(Math.min(cpuCores, maxAvailableCpus))
                  if (maxAvailableRam) setRamGb(Math.min(ramGb, maxAvailableRam))
                }}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-md transition cursor-pointer shrink-0"
              >
                Auto-Adjust to Provider Limits
              </button>
            </div>
          )}

          {/* Summary & Submit Action */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
                  Selected Hardware Profile
                </div>
                <div className="text-base font-mono font-bold text-gray-900 flex items-center gap-2">
                  <span className="text-[#bb432c]">{vram} GB VRAM</span>
                  <span className="text-gray-400">•</span>
                  <span>{cpuCores} Cores</span>
                  <span className="text-gray-400">•</span>
                  <span>{ramGb} GB RAM</span>
                </div>
              </div>

              <button
                id="rent-btn"
                onClick={handleRent}
                disabled={loading}
                className="w-full sm:w-auto px-7 py-3 bg-[#bb432c] hover:bg-[#9c3622] text-white font-semibold text-sm rounded-lg shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>Provisioning Node…</span>
                  </>
                ) : (
                  <span>Rent GPU</span>
                )}
              </button>
            </div>

            {/* Status Message */}
            {message && (
              <div className={`mt-4 p-3.5 rounded-lg text-sm border font-medium ${
                message.includes('successfully') || message.includes('✅')
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}>
                {message}
              </div>
            )}

            {/* Token & Launch Section */}
            {token && (
              <div className="mt-5 bg-white border border-gray-300 rounded-xl p-5 space-y-4 shadow-xs">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-700">Server Authorization Token</span>
                    <p className="text-xs text-gray-500">Your session has been assigned. Keep this token to access or resume your server.</p>
                  </div>
                  <span className="px-2 py-1 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-md">Ready</span>
                </div>

                <div className="bg-gray-100 p-3 rounded-lg border border-gray-200 font-mono text-xs text-gray-900 break-all select-all">
                  {token}
                </div>

                <button
                  id="launch-jupyter-btn"
                  onClick={handleLaunch}
                  className="w-full py-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                >
                  <span>Open JupyterLab Workspace</span>
                  <span>→</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
