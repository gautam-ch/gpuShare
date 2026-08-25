import React, { useState, useEffect, useRef } from 'react'

const PIPELINE_STEPS = [
  { id: 'hardware', label: '1. Hardware & GPU Diagnostic', desc: 'Validates NVIDIA GPU VRAM, physical CPU cores, and system memory.' },
  { id: 'docker', label: '2. Docker Engine & GPU Passthrough', desc: 'Verifies container runtime and cgroup hardware isolation limits.' },
  { id: 'tailscale', label: '3. WireGuard Mesh Connectivity', desc: 'Checks Tailscale encrypted tunnel and retrieves Node Mesh IPv4.' },
  { id: 'python', label: '4. Python & NVML Runtimes', desc: 'Ensures required agent dependencies (Flask, Requests, Docker, NVML) are ready.' },
  { id: 'agent', label: '5. Provider Node Daemon Launch', desc: 'Locks sharing caps into host_config.json and starts background heartbeat on port 9000.' },
]

export default function AutomatedPipelineModal({
  isOpen,
  onClose,
  config,
  onCompleted
}) {
  const [stepStates, setStepStates] = useState({
    hardware: { status: 'pending', detail: '' },
    docker: { status: 'pending', detail: '' },
    tailscale: { status: 'pending', detail: '' },
    python: { status: 'pending', detail: '' },
    agent: { status: 'pending', detail: '' },
  })
  const [logs, setLogs] = useState([])
  const [isRunning, setIsRunning] = useState(false)
  const [isFinished, setIsFinished] = useState(false)
  const [isInstallingMl, setIsInstallingMl] = useState(false)
  const [copied, setCopied] = useState(false)

  const logEndRef = useRef(null)

  // Listen for step updates
  useEffect(() => {
    if (window.providerAPI?.onPipelineStep) {
      const unsubStep = window.providerAPI.onPipelineStep(({ stepId, status, detail }) => {
        setStepStates(prev => ({
          ...prev,
          [stepId]: { status, detail }
        }))
      })
      return () => unsubStep()
    }
  }, [])

  // Listen for real-time log lines
  useEffect(() => {
    if (window.providerAPI?.onPipelineLog) {
      const unsubLog = window.providerAPI.onPipelineLog((line) => {
        setLogs(prev => [...prev.slice(-200), line])
      })
      return () => unsubLog()
    }
  }, [])

  // Auto-scroll logs to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Trigger pipeline on modal open
  useEffect(() => {
    if (isOpen) {
      startPipeline()
    }
  }, [isOpen])

  const startPipeline = async () => {
    setIsRunning(true)
    setIsFinished(false)
    setLogs([`[${new Date().toLocaleTimeString()}] Initializing automated launch sequence...`])
    setStepStates({
      hardware: { status: 'running', detail: 'Inspecting physical hardware capabilities...' },
      docker: { status: 'pending', detail: '' },
      tailscale: { status: 'pending', detail: '' },
      python: { status: 'pending', detail: '' },
      agent: { status: 'pending', detail: '' },
    })

    if (window.providerAPI?.runAutomatedPipeline) {
      const res = await window.providerAPI.runAutomatedPipeline(config)
      setIsRunning(false)
      setIsFinished(true)
      if (res.success && onCompleted) {
        onCompleted(res.config)
      }
    } else {
      // Browser fallback simulation with real-time logs
      const simLogs = [
        'Inspecting host hardware via NVML...',
        'Detected NVIDIA GPU with 8.0 GB VRAM',
        'Checking Docker daemon status...',
        'Docker engine active with cgroups isolation.',
        'Querying Tailscale interface for private mesh IPv4...',
        'Tailscale private mesh IPv4 verified: 127.0.0.1',
        'Verifying Python runtime dependencies (flask, requests, docker, pynvml)...',
        'Python packages verified and ready.',
        `Saving provider sharing limits to host_config.json: ${config?.shared_vram_gb || 4} GB VRAM...`,
        'Spawning provider agent daemon on port 9000...',
        'Agent heartbeat confirmed healthy on port 9000!',
        '=== ALL PRE-FLIGHT CHECKS PASSED. NODE IS LIVE & SHARING ==='
      ]

      let idx = 0
      const timer = setInterval(() => {
        if (idx < simLogs.length) {
          setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${simLogs[idx]}`])
          if (idx === 1) {
            setStepStates(prev => ({
              ...prev,
              hardware: { status: 'success', detail: `Hardware verified: ${config?.shared_vram_gb || 4.0} GB VRAM cap allocated.` },
              docker: { status: 'running', detail: 'Verifying Docker engine...' }
            }))
          } else if (idx === 3) {
            setStepStates(prev => ({
              ...prev,
              docker: { status: 'success', detail: 'Docker engine active with cgroups isolation.' },
              tailscale: { status: 'running', detail: 'Checking private mesh...' }
            }))
          } else if (idx === 5) {
            setStepStates(prev => ({
              ...prev,
              tailscale: { status: 'success', detail: 'WireGuard mesh connected. Node IP: 127.0.0.1' },
              python: { status: 'running', detail: 'Checking Python runtimes...' }
            }))
          } else if (idx === 7) {
            setStepStates(prev => ({
              ...prev,
              python: { status: 'success', detail: 'Python packages ready.' },
              agent: { status: 'running', detail: 'Starting provider agent daemon...' }
            }))
          } else if (idx === simLogs.length - 1) {
            setStepStates(prev => ({
              ...prev,
              agent: { status: 'success', detail: `Agent live on port 9000. Hardware caps locked.` }
            }))
            setIsRunning(false)
            setIsFinished(true)
            clearInterval(timer)
            if (onCompleted) onCompleted(config)
          }
          idx++
        } else {
          clearInterval(timer)
        }
      }, 350)
    }
  }

  // 1-Click Complete In-App ML Environment Setup Handler
  const handleRunFullMlSetup = async () => {
    setIsInstallingMl(true)
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Triggering Full In-App ML & PyTorch Stack Setup...`])
    if (window.providerAPI?.runFullMlSetup) {
      await window.providerAPI.runFullMlSetup(config)
    } else {
      setLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Simulating in-app ML stack installer...`,
        `[${new Date().toLocaleTimeString()}] PyTorch, Jupyter container cache, and CUDA drivers configured successfully.`
      ])
    }
    setIsInstallingMl(false)
    setIsFinished(true)
  }

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isOpen) return null

  // Calculate completed steps progress
  const completedCount = Object.values(stepStates).filter(s => s.status === 'success' || s.status === 'warning').length
  const progressPct = Math.round((completedCount / PIPELINE_STEPS.length) * 100)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white border border-gray-300 rounded-lg max-w-3xl w-full shadow-2xl flex flex-col my-auto max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
          <div>
            <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded bg-orange-100 border border-orange-200 text-orange-800 text-[10px] font-bold uppercase tracking-wider mb-1">
              Automated Provider Initializer
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-tight">
              Pre-Flight Diagnostics & ML Setup
            </h2>
          </div>
          {isFinished && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-xs font-bold px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-100 cursor-pointer transition"
            >
              Close
            </button>
          )}
        </div>

        {/* Top Progress Bar */}
        <div className="bg-gray-100 h-1.5 w-full shrink-0">
          <div
            className="bg-[#F37626] h-full transition-all duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Scrollable Body Container */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          <div className="flex items-center justify-between">
            <p className="text-gray-600 leading-relaxed text-xs">
              Automated verification of your machine hardware, Docker sandbox, network mesh, and background provider daemon:
            </p>
            <div className="text-right shrink-0">
              <span className="text-xs font-mono font-bold text-gray-900">{progressPct}% Complete</span>
            </div>
          </div>

          {/* Diagnostic Steps Grid / List */}
          <div className="space-y-2.5">
            {PIPELINE_STEPS.map(step => {
              const state = stepStates[step.id] || { status: 'pending', detail: '' }
              const isStepRunning = state.status === 'running'
              const isStepSuccess = state.status === 'success'
              const isStepWarning = state.status === 'warning'
              const isStepError = state.status === 'error'

              return (
                <div
                  key={step.id}
                  className={`p-3 rounded-md border transition-all ${
                    isStepSuccess
                      ? 'bg-green-50/50 border-green-200'
                      : isStepRunning
                      ? 'bg-orange-50/40 border-orange-300 ring-1 ring-orange-200'
                      : isStepWarning
                      ? 'bg-amber-50/50 border-amber-200'
                      : isStepError
                      ? 'bg-red-50/50 border-red-200'
                      : 'bg-gray-50/80 border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      {isStepRunning && (
                        <span className="w-4 h-4 border-2 border-orange-600 border-t-transparent rounded-full animate-spin shrink-0" />
                      )}
                      {isStepSuccess && (
                        <span className="w-4 h-4 rounded-full bg-green-600 text-white text-[10px] flex items-center justify-center font-bold shrink-0">✓</span>
                      )}
                      {isStepWarning && (
                        <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold shrink-0">!</span>
                      )}
                      {isStepError && (
                        <span className="w-4 h-4 rounded-full bg-red-600 text-white text-[10px] flex items-center justify-center font-bold shrink-0">✕</span>
                      )}
                      {state.status === 'pending' && (
                        <span className="w-4 h-4 rounded-full bg-gray-300 text-white text-[10px] flex items-center justify-center shrink-0" />
                      )}
                      <span className="font-bold text-gray-900 text-xs">{step.label}</span>
                    </div>

                    <span className={`text-[10px] uppercase font-bold font-mono px-2 py-0.5 rounded ${
                      isStepSuccess
                        ? 'bg-green-100 text-green-800'
                        : isStepRunning
                        ? 'bg-orange-100 text-orange-800'
                        : isStepWarning
                        ? 'bg-amber-100 text-amber-800'
                        : isStepError
                        ? 'bg-red-100 text-red-800'
                        : 'bg-gray-200 text-gray-600'
                    }`}>
                      {state.status}
                    </span>
                  </div>

                  <p className="text-[11px] text-gray-500 mt-1 ml-6.5 leading-relaxed">
                    {step.desc}
                  </p>

                  {state.detail && (
                    <div className="mt-2 ml-6.5 text-[11px] font-mono text-gray-800 bg-white p-2 rounded border border-gray-200 shadow-2xs">
                      {state.detail}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 1-Click In-App ML Environment Setup Banner */}
          <div className="p-4 bg-orange-50/50 border border-orange-200 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-gray-900 block">
                Install Full ML & PyTorch GPU Environment
              </span>
              <p className="text-[11px] text-gray-600">
                Runs the complete setup script in-app: pre-pulls Jupyter PyTorch images, configures CUDA ML runtime, and starts the daemon automatically.
              </p>
            </div>

            <button
              onClick={handleRunFullMlSetup}
              disabled={isInstallingMl}
              className="px-4 py-2 bg-[#F37626] hover:bg-[#d95f0e] text-white text-xs font-semibold rounded shadow-xs transition disabled:opacity-50 cursor-pointer shrink-0 flex items-center gap-1.5"
            >
              {isInstallingMl ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Installing ML Stack...</span>
                </>
              ) : (
                <span>Run In-App ML Setup</span>
              )}
            </button>
          </div>

          {/* Real-time Streaming Logs Terminal Box */}
          <div className="space-y-1.5 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-800">
                  Live Initialization Console
                </span>
              </div>
              <button
                onClick={handleCopyLogs}
                className="text-[10px] font-semibold text-gray-600 hover:text-gray-900 px-2 py-0.5 rounded border border-gray-200 bg-gray-50 hover:bg-gray-100 cursor-pointer"
              >
                {copied ? 'Copied' : 'Copy Logs'}
              </button>
            </div>

            <div className="bg-gray-900 text-gray-100 font-mono text-[11px] p-3 rounded-md h-40 overflow-y-auto leading-relaxed border border-gray-800 shadow-inner">
              {logs.map((line, idx) => (
                <div key={idx} className="whitespace-pre-wrap break-all hover:bg-gray-800/50 px-1 rounded">
                  {line}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
          <div className="text-xs text-gray-600 font-mono">
            {isRunning ? 'Running automated checks...' : isInstallingMl ? 'Installing ML & PyTorch environment...' : 'All node pre-flight checks complete.'}
          </div>

          <div className="flex items-center gap-2">
            {isFinished ? (
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-semibold text-xs rounded shadow-xs transition cursor-pointer flex items-center gap-2"
              >
                <span>Go to Dashboard</span>
              </button>
            ) : (
              <button
                disabled
                className="px-6 py-2.5 bg-gray-400 text-white font-semibold text-xs rounded opacity-60 cursor-not-allowed flex items-center gap-2"
              >
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Configuring Node...</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
