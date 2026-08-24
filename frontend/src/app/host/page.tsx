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
        {copied ? '✓ Copied' : 'Copy'}
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
    <div className="min-h-screen bg-[#f8f9fa] text-gray-900 flex flex-col">
      {/* JupyterHub Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 h-14 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="22" cy="7" r="4" fill="#616161" />
              <path d="M7.5 22C7.5 13.9919 13.9919 7.5 22 7.5C22.68 7.5 23.3448 7.54707 23.9942 7.63821C16.9209 8.63185 11.5 14.6806 11.5 22C11.5 29.3194 16.9209 35.3681 23.9942 36.3618C23.3448 36.4529 22.68 36.5 22 36.5C13.9919 36.5 7.5 30.0081 7.5 22Z" fill="#F37626" />
              <circle cx="22" cy="37" r="4" fill="#616161" />
              <circle cx="34" cy="14" r="3.5" fill="#616161" />
              <circle cx="10" cy="30" r="3" fill="#616161" />
            </svg>
            <span className="font-bold text-base tracking-tight text-gray-900">
              JupyterHub <span className="font-normal text-gray-500">/ Node Provider</span>
            </span>
          </div>
        </div>

        <nav className="flex items-center gap-2 sm:gap-4 text-sm font-medium text-gray-600">
          <Link href="/" className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100">
            ← Spawner
          </Link>
          <Link href="/jupyter" className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100">
            Workspace
          </Link>
          <Link href="/admin" className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100">
            Admin
          </Link>
        </nav>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 space-y-6">
        {/* Title */}
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-orange-50 border border-orange-200 text-orange-800 text-xs font-semibold uppercase tracking-wide mb-2">
            <span>Worker Node Setup</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
            Register GPU Worker Node
          </h1>
          <p className="text-gray-600 text-sm mt-1">
            Run a single setup command on your host machine to join the compute mesh. Node discovery, GPU telemetries, and secure container runtimes are fully automated.
          </p>
        </div>

        {/* Network & Security Note */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 text-xs text-gray-600 space-y-2.5 shadow-xs">
          <h3 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
            <span>🔒 Secure Peer-to-Peer Tunneling</span>
          </h3>
          <p className="leading-relaxed">
            The agent uses <strong>Tailscale WireGuard mesh networking</strong> to establish direct, end-to-end encrypted tunnels through NAT and firewalls (such as university or residential networks) without requiring open router ports.
          </p>
        </div>

        {/* Command Box Panel */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <span className="font-semibold text-xs uppercase tracking-wider text-gray-700">
              One-Line Installation Script
            </span>

            {/* OS switcher */}
            <div className="flex bg-gray-200/80 p-0.5 rounded text-xs">
              <button
                onClick={() => setOs('linux')}
                className={`px-3 py-1 rounded transition font-medium cursor-pointer ${os === 'linux' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Linux / Mac
              </button>
              <button
                onClick={() => setOs('windows')}
                className={`px-3 py-1 rounded transition font-medium cursor-pointer ${os === 'windows' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
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
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Automated Steps:</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-orange-100 text-orange-800 text-[10px] flex items-center justify-center font-bold">1</span>
                <span>Connects to encrypted mesh</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-orange-100 text-orange-800 text-[10px] flex items-center justify-center font-bold">2</span>
                <span>Installs NVML & Flask runtimes</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-orange-100 text-orange-800 text-[10px] flex items-center justify-center font-bold">3</span>
                <span>Configures Docker GPU runtime</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-orange-100 text-orange-800 text-[10px] flex items-center justify-center font-bold">4</span>
                <span>Reports capacity heartbeat</span>
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
                  <span>✓ Node successfully connected!</span>
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
                    className="inline-block px-4 py-2 bg-[#F37626] hover:bg-[#d95f0e] text-white text-xs font-semibold rounded shadow-xs transition"
                  >
                    View in Spawner →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
