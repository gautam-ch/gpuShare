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
    <div className="relative group bg-black/70 border border-white/10 rounded-xl p-5 font-mono text-sm text-emerald-300 overflow-x-auto">
      <pre className="whitespace-pre-wrap break-all pr-20 leading-relaxed">{text}</pre>
      <button
        onClick={copy}
        className="absolute top-3 right-3 bg-white/10 hover:bg-emerald-600 px-3 py-1.5 rounded-lg text-xs text-white transition font-sans font-medium"
      >
        {copied ? '✓ Copied!' : 'Copy'}
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
    <main className="min-h-screen text-white">
      <header className="border-b border-white/10 px-6 py-4 flex justify-between items-center sticky top-0 bg-slate-950/90 backdrop-blur z-50">
        <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
          GPU Share Hub
        </h1>
        <nav className="flex gap-6">
          <Link href="/" className="text-sm hover:text-emerald-400 transition-colors">← Rent GPU</Link>
          <Link href="/jupyter" className="text-sm hover:text-cyan-400 transition-colors">Jupyter</Link>
        </nav>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-14 space-y-10">

        {/* Hero */}
        <div className="text-center space-y-3">
          <h2 className="text-4xl font-extrabold tracking-tight">
            Host your <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500">GPU</span>
          </h2>
          <p className="text-slate-400 max-w-lg mx-auto">
            Run <strong className="text-white">one command</strong> in your terminal. Everything else — networking, GPU detection, Jupyter — is fully automatic.
          </p>
        </div>

        {/* Why Tailscale explanation */}
        <div className="bg-blue-950/40 border border-blue-500/20 rounded-xl p-5 space-y-3">
          <h3 className="font-semibold text-blue-300 flex items-center gap-2">
            <span>📡</span> Why does this need Tailscale?
          </h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            You're on hostel/college WiFi. The router hides your laptop behind NAT — other devices can't reach you directly.
            <strong className="text-slate-200"> Tailscale creates an encrypted private tunnel</strong> between your laptop and the platform, 
            bypassing the router automatically. It runs silently in the background.
          </p>
          <div className="grid grid-cols-3 gap-3 text-xs text-center">
            <div className="bg-blue-900/30 rounded-lg p-2 text-slate-300">
              🔒 Encrypted tunnel<br/>
              <span className="text-slate-500">No one can intercept</span>
            </div>
            <div className="bg-blue-900/30 rounded-lg p-2 text-slate-300">
              📶 Works on any WiFi<br/>
              <span className="text-slate-500">Hostel, college, home</span>
            </div>
            <div className="bg-blue-900/30 rounded-lg p-2 text-slate-300">
              ⚙️ Auto on boot<br/>
              <span className="text-slate-500">Set up once, forget it</span>
            </div>
          </div>
        </div>

        {/* ONE-COMMAND INSTALLER */}
        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <span className="font-semibold text-sm">Auto Installer — One command does everything</span>
            {/* OS tab switcher */}
            <div className="flex bg-black/40 rounded-lg p-1 text-xs gap-1">
              <button
                onClick={() => setOs('linux')}
                className={`px-3 py-1 rounded-md transition font-medium ${os === 'linux' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Linux / Mac
              </button>
              <button
                onClick={() => setOs('windows')}
                className={`px-3 py-1 rounded-md transition font-medium ${os === 'windows' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Windows
              </button>
            </div>
          </div>

          <div className="p-5 space-y-3">
            <CopyBox text={os === 'linux' ? linuxCmd : windowsCmd} />
            <p className="text-xs text-slate-500">
              {os === 'linux'
                ? 'Open Terminal and paste this. sudo password may be required for Tailscale.'
                : 'Open PowerShell as Administrator and paste this.'}
            </p>
          </div>

          {/* What this command does */}
          <div className="px-5 pb-5">
            <p className="text-xs text-slate-500 font-semibold mb-2 uppercase tracking-wider">This command automatically:</p>
            <div className="space-y-2">
              {[
                ['1', 'Installs Tailscale and connects to our private network (no login needed)'],
                ['2', 'Installs Python packages: pynvml, flask, docker'],
                ['3', 'Downloads the GPU Share Hub agent from this platform'],
                ['4', 'Starts the agent — your machine reports its GPU stats every 15 seconds'],
              ].map(([num, desc]) => (
                <div key={num} className="flex items-start gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-emerald-600/30 text-emerald-400 text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">{num}</span>
                  <span className="text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Ran the command? detect machine */}
        {!started ? (
          <button
            onClick={() => setStarted(true)}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-xl text-sm font-medium transition"
          >
            ✅ I ran the command — detect my machine
          </button>
        ) : (
          <div className={`border rounded-xl p-6 transition-all ${machineFound ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900 border-white/10'}`}>
            {!machineFound ? (
              <div className="flex items-center gap-3 text-sm text-slate-400">
                <span className="w-3 h-3 rounded-full bg-yellow-400 animate-pulse shrink-0"></span>
                <div>
                  <p className="font-medium text-white">Waiting for your machine…</p>
                  <p className="text-xs mt-1">Checking every 5 seconds. Make sure the command is running in your terminal.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-emerald-400 font-bold text-lg">🎉 Your machine is live!</p>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-slate-500 mb-1">Machine ID</p>
                    <p className="text-white break-all">{machineInfo?.id}</p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-slate-500 mb-1">Tailscale IP</p>
                    <p className="text-white">{machineInfo?.tailscale_ip}</p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-slate-500 mb-1">VRAM</p>
                    <p className="text-white">{machineInfo ? (machineInfo.vram_total_mb / 1024).toFixed(1) : '—'} GB</p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-slate-500 mb-1">Status</p>
                    <p className="text-emerald-400">● {machineInfo?.status}</p>
                  </div>
                </div>
                <Link
                  href="/"
                  className="inline-block mt-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-semibold transition"
                >
                  View on marketplace →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* After first time note */}
        <div className="text-center text-xs text-slate-600 space-y-1">
          <p>After the first setup, Tailscale runs automatically on every boot.</p>
          <p>You only ever need to run the agent command again to re-register.</p>
        </div>
      </div>
    </main>
  )
}
