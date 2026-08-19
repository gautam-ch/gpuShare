"use client"
import { useState, useEffect } from 'react'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

interface Preset {
  id: string
  name: string
  icon: string
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
    icon: '🧪',
    badge: 'Popular for Beginners',
    vram: 2,
    cpus: 2,
    ram: 4,
    desc: 'Lightweight experimentation, Pandas/Numpy data cleaning, Scikit-learn models & basic PyTorch tensors.',
    workloads: ['Tabular ML (XGBoost / LightGBM)', 'Data Preprocessing & EDA', 'Intro PyTorch / TF Tutorials']
  },
  {
    id: 'vision',
    name: 'Computer Vision & CNNs',
    icon: '🖼️',
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
    icon: '⚡',
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
          const live = data.filter(m => m.status === 'online')
          setOnlineMachines(live)
          if (live.length > 0) {
            const maxV = Math.max(...live.map(m => (m.vram_free_mb || 0) / 1024))
            const maxC = Math.max(...live.map(m => m.cpus || 0))
            const roundedMaxV = Math.floor(maxV * 10) / 10
            setMaxAvailableVram(roundedMaxV)
            setMaxAvailableCpus(maxC)

            // Auto-adjust initial preset if 4GB is greater than max available
            if (roundedMaxV < 4 && roundedMaxV > 0) {
              setVram(roundedMaxV >= 2 ? 2 : roundedMaxV)
              setSelectedPreset('starter')
            }
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
        setMessage(`✅ ${data.message}`)
      } else {
        setMessage(`❌ ${data.detail || 'Something went wrong'}`)
      }
    } catch (e) {
      setMessage('❌ Could not reach backend. Is it running?')
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

  return (
    <section className="max-w-4xl mx-auto space-y-8 pb-16">
      {/* Hero Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          {onlineMachines.length > 0 ? (
            <span>{onlineMachines.length} Host Machine{onlineMachines.length > 1 ? 's' : ''} Online • Max {maxAvailableVram} GB VRAM Available</span>
          ) : (
            <span>Instant Tailnet GPU Marketplace</span>
          )}
        </div>
        <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
          Rent On-Demand <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400">GPU Compute</span>
        </h2>
        <p className="text-slate-400 max-w-2xl mx-auto text-sm md:text-base">
          Configure your GPU VRAM, CPU cores, and system memory. We automatically pair you with an online host and spin up a dedicated Jupyter workspace.
        </p>
      </div>

      {/* Preset Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
            1. Select a Workload Tier or Customize Below
          </label>
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="text-xs text-cyan-400 hover:text-cyan-300 underline flex items-center gap-1 transition"
          >
            {showGuide ? 'Hide Workload Guide' : '💡 Need help choosing? View Guide'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PRESETS.map(preset => {
            const isSelected = selectedPreset === preset.id
            const exceeds = maxAvailableVram !== null && preset.vram > maxAvailableVram
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`text-left p-5 rounded-xl border transition-all duration-200 relative overflow-hidden flex flex-col justify-between ${
                  isSelected
                    ? 'bg-slate-800/90 border-emerald-400 ring-2 ring-emerald-500/30 shadow-lg shadow-emerald-950/40'
                    : 'bg-slate-900/60 border-white/10 hover:border-white/20 hover:bg-slate-800/40'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden">
                    <div className="bg-emerald-500 text-[10px] font-bold text-slate-950 text-center py-0.5 transform rotate-45 translate-x-4 translate-y-2 shadow-sm">
                      ACTIVE
                    </div>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{preset.icon}</span>
                      <span className="font-bold text-slate-100 text-sm">{preset.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-0.5 bg-slate-800 border border-white/10 rounded text-[11px] font-medium text-emerald-300">
                      {preset.badge}
                    </span>
                    {exceeds && (
                      <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded text-[10px] font-medium text-amber-300">
                        Exceeds Live VRAM
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed mb-4">
                    {preset.desc}
                  </p>
                </div>
                <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs font-mono text-slate-300">
                  <span className="text-emerald-400 font-semibold">{preset.vram} GB VRAM</span>
                  <span>{preset.cpus} CPUs</span>
                  <span>{preset.ram} GB RAM</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Guide Accordion */}
      {showGuide && (
        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-5 text-sm space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-base">
            <span>💡 How Production Cloud GPU Specs Work</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300">
            <div className="bg-slate-950/60 p-4 rounded-lg border border-white/5 space-y-2">
              <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                <span>🎮 GPU VRAM (Memory)</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Determines <strong>how large of a model or batch size</strong> fits directly on the GPU.
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-400">
                <li><strong className="text-slate-200">2-4 GB:</strong> Tabular models, ResNet-18/50, YOLOv8 inference.</li>
                <li><strong className="text-slate-200">6-8 GB:</strong> Stable Diffusion v1.5, Whisper Base/Small, PyTorch CNN training.</li>
                <li><strong className="text-slate-200">12-16+ GB:</strong> 7B-13B LLMs (4-bit quantized), LoRA fine-tuning.</li>
              </ul>
            </div>

            <div className="bg-slate-950/60 p-4 rounded-lg border border-white/5 space-y-2">
              <div className="font-bold text-cyan-400 flex items-center gap-1.5">
                <span>⚙️ CPU Cores</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Powers <strong>data preprocessing, tokenization & DataLoader workers</strong> so the GPU never starves.
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-400">
                <li><strong className="text-slate-200">2 Cores:</strong> Standard notebooks & lightweight data loads.</li>
                <li><strong className="text-slate-200">4 Cores:</strong> Fast image augmentation & parallel DataLoader batches.</li>
                <li><strong className="text-slate-200">8+ Cores:</strong> High-throughput streaming datasets & heavy tokenization.</li>
              </ul>
            </div>

            <div className="bg-slate-950/60 p-4 rounded-lg border border-white/5 space-y-2">
              <div className="font-bold text-indigo-400 flex items-center gap-1.5">
                <span>💾 System RAM</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Stores your <strong>raw datasets, Pandas DataFrames & NumPy arrays</strong> in system memory before GPU transfer.
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-400">
                <li><strong className="text-slate-200">4 GB:</strong> Small CSV/JSON datasets (&lt; 1 GB).</li>
                <li><strong className="text-slate-200">8 GB:</strong> Image folders, medium datasets, Pandas operations.</li>
                <li><strong className="text-slate-200">16+ GB:</strong> Heavy video datasets, NLP corpora, large in-memory caches.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Resource Customization Box */}
      <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-6 md:p-8 space-y-8 backdrop-blur-sm">
        <div className="border-b border-white/10 pb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-100">2. Fine-Tune Resource Allocation</h3>
            <p className="text-xs text-slate-400 mt-0.5">Adjust sliders to match your exact hardware requirements.</p>
          </div>
          {selectedPreset === 'custom' && (
            <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold rounded-md">
              Custom Config
            </span>
          )}
        </div>

        {/* 1. VRAM Slider */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <span>🎮 Dedicated GPU VRAM</span>
              </span>
              <span className="text-xs text-slate-400">Controls maximum model parameter size & batch capacity</span>
            </div>
            <div className="px-3 py-1 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-emerald-400 font-mono font-bold text-base">
              {vram} GB
            </div>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {[1, 2, 4, 6, 8, 12].map(v => {
              const disabled = maxAvailableVram !== null && v > maxAvailableVram
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => handleCustomChange('vram', v)}
                  className={`py-2 text-xs font-mono font-bold rounded-lg border transition relative ${
                    vram === v
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-900/30'
                      : disabled
                      ? 'bg-slate-900/40 border-white/5 text-slate-600 hover:text-slate-400'
                      : 'bg-slate-800/80 border-white/10 text-slate-300 hover:bg-slate-700 hover:border-white/20'
                  }`}
                >
                  {v} GB
                  {disabled && (
                    <span className="block text-[9px] font-sans text-slate-500 font-normal">Offline</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* 2. CPU Cores Slider */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <span>⚙️ CPU Cores</span>
              </span>
              <span className="text-xs text-slate-400">Powers dataset loading, tokenization, & OS processes</span>
            </div>
            <div className="px-3 py-1 bg-cyan-500/20 border border-cyan-500/40 rounded-lg text-cyan-400 font-mono font-bold text-base">
              {cpuCores} {cpuCores === 1 ? 'Core' : 'Cores'}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 4, 6, 8].map(c => {
              const disabled = maxAvailableCpus !== null && c > maxAvailableCpus
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleCustomChange('cpu', c)}
                  className={`py-2 text-xs font-mono font-bold rounded-lg border transition ${
                    cpuCores === c
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-900/30'
                      : disabled
                      ? 'bg-slate-900/40 border-white/5 text-slate-600 hover:text-slate-400'
                      : 'bg-slate-800/80 border-white/10 text-slate-300 hover:bg-slate-700 hover:border-white/20'
                  }`}
                >
                  {c} {c === 1 ? 'Core' : 'Cores'}
                </button>
              )
            })}
          </div>
        </div>

        {/* 3. System RAM Slider */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <span>💾 System Memory (RAM)</span>
              </span>
              <span className="text-xs text-slate-400">Stores in-memory datasets, Pandas DataFrames & NumPy arrays</span>
            </div>
            <div className="px-3 py-1 bg-indigo-500/20 border border-indigo-500/40 rounded-lg text-indigo-400 font-mono font-bold text-base">
              {ramGb} GB
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[2, 4, 8, 12, 16].map(r => (
              <button
                key={r}
                type="button"
                onClick={() => handleCustomChange('ram', r)}
                className={`py-2 text-xs font-mono font-bold rounded-lg border transition ${
                  ramGb === r
                    ? 'bg-indigo-500 text-slate-950 border-indigo-400 shadow-md shadow-indigo-900/30'
                    : 'bg-slate-800/80 border-white/10 text-slate-300 hover:bg-slate-700 hover:border-white/20'
                }`}
              >
                {r} GB
              </button>
            ))}
          </div>
        </div>

        {/* Capacity Warning If Selected > Available */}
        {(isOverVram || isOverCpu) && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-amber-200">
            <div>
              <strong className="font-semibold text-amber-300">⚠️ Allocation Exceeds Live Host Capacity:</strong>
              <p className="text-slate-300 mt-0.5">
                Online machines currently offer max {maxAvailableVram} GB VRAM & {maxAvailableCpus} CPUs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (maxAvailableVram) setVram(maxAvailableVram)
                if (maxAvailableCpus) setCpuCores(Math.min(cpuCores, maxAvailableCpus))
              }}
              className="px-3 py-1.5 bg-amber-500 text-slate-950 font-bold rounded-lg hover:bg-amber-400 transition shrink-0"
            >
              Auto-Adjust to {maxAvailableVram} GB
            </button>
          </div>
        )}

        {/* Spec Summary & Rent CTA */}
        <div className="pt-6 border-t border-white/10 space-y-4">
          <div className="bg-slate-950/70 p-4 rounded-xl border border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="space-y-1 text-center md:text-left">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Selected Allocation</span>
              <div className="text-sm font-mono font-bold text-slate-100 flex items-center gap-3">
                <span className="text-emerald-400">{vram} GB VRAM</span>
                <span className="text-slate-600">•</span>
                <span className="text-cyan-400">{cpuCores} CPU Cores</span>
                <span className="text-slate-600">•</span>
                <span className="text-indigo-400">{ramGb} GB RAM</span>
              </div>
            </div>
            <button
              id="rent-btn"
              onClick={handleRent}
              disabled={loading}
              className="w-full md:w-auto px-8 py-3.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition transform hover:-translate-y-0.5 active:translate-y-0 text-sm"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin h-4 w-4 border-2 border-slate-950 border-t-transparent rounded-full" />
                  Matching Online Host…
                </span>
              ) : (
                '⚡ Rent & Provision GPU'
              )}
            </button>
          </div>

          {message && (
            <div className={`p-4 rounded-xl text-center text-sm font-medium border ${
              message.startsWith('✅')
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                : 'bg-red-950/40 border-red-500/30 text-red-300'
            }`}>
              {message}
            </div>
          )}

          {token && (
            <div className="bg-slate-950 border border-cyan-500/30 rounded-xl p-5 space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <span className="text-xs text-cyan-400 font-bold uppercase tracking-wider">Session Token Generated</span>
                <span className="text-xs text-slate-500 font-mono">Status: Ready</span>
              </div>
              <div className="bg-slate-900 px-3 py-2 rounded-lg border border-white/5 font-mono text-xs text-slate-300 break-all select-all">
                {token}
              </div>
              <button
                id="launch-jupyter-btn"
                onClick={handleLaunch}
                className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-cyan-500/25 transition text-sm flex items-center justify-center gap-2"
              >
                <span>🚀 Launch Jupyter Workspace</span>
                <span>→</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
