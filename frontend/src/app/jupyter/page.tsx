"use client"
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

const PROGRESS_MESSAGES = [
  'Reserving GPU machine…',
  'Starting Docker container…',
  'Pulling Jupyter image (first time: ~2 min)…',
  'Container is initializing…',
  'Creating secure tunnel…',
  'Almost ready…',
]

export default function JupyterPage() {
  const searchParams = useSearchParams()
  const [token, setToken] = useState('')
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [launched, setLaunched] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const didAutoLaunch = useRef(false)

  // Pre-fill token from URL and auto-launch
  useEffect(() => {
    const t = searchParams.get('token')
    if (t && !didAutoLaunch.current) {
      didAutoLaunch.current = true
      setToken(t)
      // Small delay so state updates before launch
      setTimeout(() => triggerLaunch(t), 100)
    }
  }, [searchParams])

  // Cycle through progress messages while loading
  useEffect(() => {
    if (!loading) return
    const t = setInterval(() => {
      setProgressIdx(i => Math.min(i + 1, PROGRESS_MESSAGES.length - 1))
    }, 18000)
    return () => clearInterval(t)
  }, [loading])

  const triggerLaunch = async (launchToken?: string) => {
    const tk = launchToken || token
    if (!tk) return
    setLoading(true)
    setProgressIdx(0)
    setMessage('')

    try {
      const res = await fetch(`${BACKEND_URL}/start-jupyter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tk })
      })
      const data = await res.json()

      if (!res.ok) {
        setMessage(`❌ ${data.detail || 'Failed to start session'}`)
        setLoading(false)
        return
      }

      if (data.jupyter_url) {
        setUrl(data.jupyter_url)
        setLaunched(true)
        setLoading(false)
        return
      }

      const job_id = data.job_id
      const machine_ip = data.machine_tailscale_ip
      if (!job_id) {
        setMessage('❌ No job ID returned from backend')
        setLoading(false)
        return
      }

      pollRef.current = setInterval(async () => {
        try {
          const poll = await fetch(`${BACKEND_URL}/session-status/${job_id}?machine_ip=${machine_ip}`)
          const result = await poll.json()
          if (result.status === 'done') {
            clearInterval(pollRef.current!)
            const jupyterUrl = result.jupyter_url
            setUrl(jupyterUrl)
            setLaunched(true)
            setLoading(false)
            // Open in new tab immediately — bypasses CSP iframe restriction
            window.open(jupyterUrl, '_blank')
          } else if (result.status === 'error') {
            clearInterval(pollRef.current!)
            setMessage(`❌ ${result.detail}`)
            setLoading(false)
          }
        } catch { /* retry */ }
      }, 3000)

    } catch {
      setMessage('❌ Could not contact backend. Is it running?')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen text-white flex flex-col">
      <header className="border-b border-white/10 px-6 py-4 flex justify-between items-center shrink-0">
        <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
          GPU Share Hub — Jupyter Workspace
        </h1>
        <nav className="flex gap-6">
          <Link href="/" className="text-sm hover:text-emerald-400 transition-colors">← Rent GPU</Link>
          <Link href="/host" className="text-sm hover:text-cyan-400 transition-colors">Host GPU</Link>
        </nav>
      </header>

      {!launched ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-white/10 rounded-xl p-8 max-w-md w-full space-y-4">
            <h2 className="text-2xl font-bold text-center">Launch Your Workspace</h2>
            <p className="text-slate-400 text-sm text-center">
              Paste the access token you received after renting a GPU to start your Jupyter session.
            </p>
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Access Token</span>
              <input
                id="token-input"
                type="text"
                placeholder="Paste token here…"
                value={token}
                onChange={e => setToken(e.target.value)}
                disabled={loading}
                className="mt-2 block w-full rounded-lg bg-slate-800 border border-white/10 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-sm transition disabled:opacity-50"
              />
            </label>
            <button
              id="launch-btn"
              onClick={() => triggerLaunch()}
              disabled={loading || !token}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-70 disabled:cursor-not-allowed rounded-lg font-semibold transition-all"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  {PROGRESS_MESSAGES[progressIdx]}
                </span>
              ) : '🚀 Launch Jupyter'}
            </button>

            {loading && (
              <div className="bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-slate-400 space-y-1">
                <p className="text-slate-300 font-medium">What's happening:</p>
                <p>✅ GPU reserved</p>
                <p className={progressIdx >= 1 ? 'text-white' : ''}>⏳ Starting Jupyter container…</p>
                <p className={progressIdx >= 4 ? 'text-white' : 'text-slate-500'}>⏳ Creating Cloudflare tunnel…</p>
                <p className="text-slate-500 italic">First launch takes 2-3 min (Docker pulls image once)</p>
              </div>
            )}

            {message && <p className="text-sm text-center">{message}</p>}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 bg-slate-900 border-b border-white/10 flex items-center justify-between shrink-0">
            <span className="text-xs text-slate-400 font-mono">{url}</span>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs bg-cyan-600 hover:bg-cyan-500 px-3 py-1 rounded transition"
            >
              Open in new tab ↗
            </a>
          </div>
          <iframe
            src={url}
            className="flex-1 w-full border-0"
            title="Jupyter Workspace"
          />
        </div>
      )}
    </main>
  )
}

