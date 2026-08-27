"use client"
import Link from 'next/link'
import { useState, useEffect } from 'react'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  return (
    <div className="relative group bg-gray-900 border border-gray-800 rounded-md p-4 font-mono text-xs text-gray-100 overflow-x-auto">
      <pre className="whitespace-pre-wrap break-all pr-20 leading-relaxed font-mono">{text}</pre>
      <button
        onClick={copy}
        className="absolute top-2.5 right-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-1 rounded text-xs text-gray-200 transition font-sans font-medium cursor-pointer"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export default function HostPage() {
  const [os, setOs] = useState<'linux' | 'windows'>('linux')
  const [checking, setChecking] = useState(false)
  const [machineFound, setMachineFound] = useState(false)
  const [machineInfo, setMachineInfo] = useState<any>(null)
  const [started, setStarted] = useState(false)

  // Detect OS
  useEffect(() => {
    if (navigator.userAgent.includes('Windows')) setOs('windows')
  }, [])

  // Poll backend every 5s once user clicks "I ran the command"
  useEffect(() => {
    if (!started || machineFound) return
    setChecking(true)
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/machines`)
        if (res.ok) {
          const machines = await res.json()
          if (machines.length > 0) {
            setMachineFound(true)
            setMachineInfo(machines[machines.length - 1])
            clearInterval(interval)
            setChecking(false)
          }
        }
      } catch { /* ignore */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [started, machineFound])

  const linuxCmd = `curl -sSL ${BACKEND_URL}/install-script | bash`
  const windowsCmd = `irm ${BACKEND_URL}/install-script-windows | iex`

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-gray-900 flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-gray-200/80 px-4 sm:px-6 h-14 flex justify-between items-center sticky top-0 z-50 shadow-xs">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 text-decoration-none group">
            {/* Unique Kinetic Dynamic Symbol */}
            <svg className="w-7 h-7 transition-transform duration-300 group-hover:scale-105" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="7" fill="#111827" />
              <path d="M8 8L16 16L8 24" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
              <path d="M14 8L22 16L14 24" stroke="#bb432c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="23.5" cy="16" r="2" fill="#bb432c" />
            </svg>
            <span className="font-bold text-lg tracking-tight text-gray-900">
              Kinetic
            </span>
          </Link>
        </div>

        <nav className="flex items-center gap-2 sm:gap-4 text-sm font-medium text-gray-600">
          <Link href="/" className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100/80">
            Rent GPU
          </Link>
          <Link href="/jupyter" className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100/80">
            Workspace
          </Link>
          <Link href="/host" className="px-3 py-1.5 text-[#bb432c] border-b-2 border-[#bb432c] font-semibold">
            Host a Node
          </Link>
        </nav>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 space-y-6">
        {/* Title */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
            Register GPU Worker Node
          </h1>
          <p className="text-gray-600 text-sm mt-1">
            Run the setup command on your host machine to join the compute mesh. Node discovery, GPU telemetries, and secure container runtimes are fully automated.
          </p>
        </div>

        {/* Windows Prerequisites Card */}
        <div className="bg-white border border-gray-200/80 rounded-xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
              <span>📋 Host Prerequisites</span>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                Required for Windows
              </span>
            </h3>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            Before running the node agent, ensure the following two applications are installed and running on your host machine:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <a
              href="https://tailscale.com/download/windows"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-[#bb432c]/40 hover:bg-[#bb432c]/5 transition group text-decoration-none"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center font-bold text-gray-700 text-xs shrink-0 group-hover:bg-[#bb432c] group-hover:text-white transition-colors">
                1
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-gray-900 group-hover:text-[#bb432c] flex items-center gap-1">
                  Install Tailscale
                  <span className="text-[10px]">↗</span>
                </div>
                <p className="text-[11px] text-gray-500">
                  Encrypted mesh networking to connect without port forwarding.
                </p>
                <span className="text-[10px] text-[#bb432c] font-mono font-medium block">
                  tailscale.com/download/windows
                </span>
              </div>
            </a>

            <a
              href="https://www.docker.com/products/docker-desktop/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-[#bb432c]/40 hover:bg-[#bb432c]/5 transition group text-decoration-none"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center font-bold text-gray-700 text-xs shrink-0 group-hover:bg-[#bb432c] group-hover:text-white transition-colors">
                2
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-gray-900 group-hover:text-[#bb432c] flex items-center gap-1">
                  Install Docker Desktop
                  <span className="text-[10px]">↗</span>
                </div>
                <p className="text-[11px] text-gray-500">
                  Container runtime with NVIDIA GPU WSL2 acceleration.
                </p>
                <span className="text-[10px] text-[#bb432c] font-mono font-medium block">
                  docker.com/products/docker-desktop
                </span>
              </div>
            </a>
          </div>
        </div>

        {/* Command Box Panel */}
        <div className="bg-white border border-gray-200/80 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-gray-200/80 bg-gray-50/80 flex items-center justify-between">
            <span className="font-semibold text-xs uppercase tracking-wider text-gray-700">
              One-Line Installation Script
            </span>

            {/* OS switcher */}
            <div className="flex bg-gray-200/80 p-0.5 rounded-lg text-xs">
              <button
                onClick={() => setOs('linux')}
                className={`px-3 py-1 rounded-md transition font-medium cursor-pointer ${os === 'linux' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Linux / Mac
              </button>
              <button
                onClick={() => setOs('windows')}
                className={`px-3 py-1 rounded-md transition font-medium cursor-pointer ${os === 'windows' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Windows (PowerShell)
              </button>
            </div>
          </div>

          <div className="p-5 space-y-3">
            <CopyBox text={os === 'linux' ? linuxCmd : windowsCmd} />
            <p className="text-xs text-gray-500">
              {os === 'linux'
                ? 'Run in your terminal. Sudo permissions may be requested for Tailscale network daemon.'
                : 'Open PowerShell as Administrator and run the command above.'}
            </p>
          </div>

          {/* Steps summary */}
          <div className="px-5 pb-5 pt-2 border-t border-gray-100">
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Automated Execution Pipeline:</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-[#bb432c]/10 text-[#bb432c] text-[10px] flex items-center justify-center font-bold">1</span>
                <span>Connects to encrypted Tailscale mesh</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-[#bb432c]/10 text-[#bb432c] text-[10px] flex items-center justify-center font-bold">2</span>
                <span>Queries NVML VRAM & CPU metrics</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-[#bb432c]/10 text-[#bb432c] text-[10px] flex items-center justify-center font-bold">3</span>
                <span>Attaches Docker GPU container runtime</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-[#bb432c]/10 text-[#bb432c] text-[10px] flex items-center justify-center font-bold">4</span>
                <span>Sends 3s real-time heartbeat to controller</span>
              </div>
            </div>
          </div>
        </div>

        {/* Verification Status */}
        {!started ? (
          <button
            onClick={() => setStarted(true)}
            className="w-full py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-md text-sm font-semibold transition cursor-pointer shadow-xs"
          >
            I ran the command — Check node status
          </button>
        ) : (
          <div className={`border rounded-lg p-5 transition-all ${machineFound ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 shadow-xs'}`}>
            {!machineFound ? (
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <span className="w-3 h-3 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
                <div>
                  <p className="font-semibold text-gray-900">Waiting for node registration…</p>
                  <p className="text-xs text-gray-500 mt-0.5">Polling cluster controller every 5s. Confirm the script is running in your terminal.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-800 font-bold text-base">
                  <span>Node successfully connected</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <div className="bg-white p-2.5 rounded border border-gray-200">
                    <span className="text-gray-500 block text-[10px] uppercase font-sans">Node ID</span>
                    <span className="text-gray-900 font-bold break-all">{machineInfo?.id}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-gray-200">
                    <span className="text-gray-500 block text-[10px] uppercase font-sans">Mesh IP</span>
                    <span className="text-gray-900 font-bold">{machineInfo?.tailscale_ip}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-gray-200">
                    <span className="text-gray-500 block text-[10px] uppercase font-sans">Total VRAM</span>
                    <span className="text-gray-900 font-bold">{machineInfo ? (machineInfo.vram_total_mb / 1024).toFixed(1) : '—'} GB</span>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-gray-200">
                    <span className="text-gray-500 block text-[10px] uppercase font-sans">Status</span>
                    <span className="text-green-700 font-bold uppercase">{machineInfo?.status}</span>
                  </div>
                </div>
                <div className="pt-2">
                  <Link
                    href="/"
                    className="inline-block px-4 py-2 bg-[#bb432c] hover:bg-[#9c3622] text-white text-xs font-semibold rounded-lg shadow-xs transition"
                  >
                    View in Rent Page →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-gray-200/80 bg-white py-6 mt-12 text-center text-xs text-gray-500">
        <div className="max-w-6xl mx-auto px-4 flex justify-center items-center gap-1.5">
          <span>Made with</span>
          <svg className="w-3.5 h-3.5 fill-[#bb432c] inline-block" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          <span>by IIITS</span>
        </div>
      </footer>
    </div>
  )
}
