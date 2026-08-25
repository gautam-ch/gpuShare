import React, { useState, useEffect, useRef } from 'react'

export default function SetupRunnerModal({
  isOpen,
  onClose,
  providerConfig,
  agentOnline,
  onStartAgent,
  onStopAgent
}) {
  const [logs, setLogs] = useState([])
  const [runningSetup, setRunningSetup] = useState(false)
  const [setupMessage, setSetupMessage] = useState('')
  const logEndRef = useRef(null)

  useEffect(() => {
    if (window.providerAPI?.onAgentLog) {
      const unsub = window.providerAPI.onAgentLog((text) => {
        setLogs((prev) => [...prev.slice(-100), text])
      })
      return () => unsub()
    }
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  if (!isOpen) return null

  const handleRunElevated = async () => {
    setRunningSetup(true)
    setSetupMessage('Launching Administrator installer window...')
    if (window.providerAPI?.startElevatedSetup) {
      const res = await window.providerAPI.startElevatedSetup()
      if (res.success) {
        setSetupMessage('Elevated setup process launched. Check the PowerShell prompt on your screen to complete one-time configuration.')
      } else {
        setSetupMessage(`Setup error: ${res.error || 'Failed to start elevated installer'}`)
      }
    } else {
      setSetupMessage('In desktop Electron mode, this executes the elevated Windows PowerShell script automatically.')
    }
    setRunningSetup(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-gray-300 rounded-lg max-w-2xl w-full shadow-lg overflow-hidden animate-in fade-in duration-150 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
          <div>
            <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded bg-orange-100 border border-orange-200 text-orange-800 text-[10px] font-bold uppercase tracking-wider mb-1">
              One-Click Automated Service
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-tight">
              Node Initializer & Administrator Setup
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-sm font-bold px-2 py-1 rounded cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          <p className="text-gray-600 leading-relaxed">
            Run the automated host setup with elevated Administrator permissions. This script connects to the encrypted WireGuard mesh, configures Docker GPU passthrough, and launches your background provider agent with your selected sharing limits.
          </p>

          {/* Automated Steps Checklist */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-gray-50 border border-gray-200 rounded">
              <span className="font-bold text-gray-900 block mb-0.5">1. Tailscale WireGuard Mesh</span>
              <span className="text-gray-500 text-[11px]">Enables encrypted peer-to-peer tunnels behind NAT.</span>
            </div>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded">
              <span className="font-bold text-gray-900 block mb-0.5">2. Docker GPU Passthrough</span>
              <span className="text-gray-500 text-[11px]">Configures NVIDIA runtime & memory sandboxing.</span>
            </div>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded">
              <span className="font-bold text-gray-900 block mb-0.5">3. PyTorch & NVML Drivers</span>
              <span className="text-gray-500 text-[11px]">Pre-pulls Jupyter PyTorch images for instant spawning.</span>
            </div>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded">
              <span className="font-bold text-gray-900 block mb-0.5">4. Provider Agent Daemon</span>
              <span className="text-gray-500 text-[11px]">Runs background heartbeat with your configured caps.</span>
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded space-y-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div>
                <span className="font-bold text-gray-900 block">First-Time Automated Setup</span>
                <span className="text-gray-500 text-[11px]">Prompts UAC Administrator confirmation to install prerequisites.</span>
              </div>
              <button
                onClick={handleRunElevated}
                disabled={runningSetup}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#F37626] hover:bg-[#d95f0e] text-white font-semibold text-xs rounded shadow-xs transition disabled:opacity-50 cursor-pointer shrink-0"
              >
                {runningSetup ? 'Launching...' : 'Run Full Setup as Administrator'}
              </button>
            </div>

            {setupMessage && (
              <div className="p-2.5 bg-white border border-gray-300 rounded text-gray-800 text-[11px] font-mono">
                {setupMessage}
              </div>
            )}
          </div>

          {/* Agent Service Controls */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded flex items-center justify-between">
            <div>
              <span className="font-bold text-gray-900 block">Local Agent Service Status</span>
              <span className="text-gray-500 text-[11px]">
                {agentOnline ? 'Agent is actively running on port 9000' : 'Agent daemon is currently idle'}
              </span>
            </div>
            {agentOnline ? (
              <button
                onClick={onStopAgent}
                className="px-4 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-semibold rounded transition cursor-pointer"
              >
                Stop Agent Service
              </button>
            ) : (
              <button
                onClick={() => onStartAgent(providerConfig)}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded shadow-xs transition cursor-pointer"
              >
                Start Agent Service
              </button>
            )}
          </div>

          {/* Real-time Agent Log Stream */}
          {logs.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">
                Live Agent Output Log
              </span>
              <div className="bg-gray-900 text-gray-100 font-mono text-[11px] p-3 rounded h-32 overflow-y-auto leading-relaxed border border-gray-800">
                {logs.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-all">{line}</div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs rounded transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
