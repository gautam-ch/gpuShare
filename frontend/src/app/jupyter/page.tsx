"use client"
import { useState, useEffect, useRef, Suspense } from 'react'
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

function JupyterWorkspace() {
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
        setMessage(`Error: ${data.detail || 'Failed to start session'}`)
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
        setMessage('Error: No job ID returned from backend')
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
            setMessage(`Error: ${result.detail}`)
            setLoading(false)
          }
        } catch { /* retry */ }
      }, 3000)

    } catch {
      setMessage('Could not contact cluster controller. Ensure backend is running.')
      setLoading(false)
    }
  }

  const [stopping, setStopping] = useState(false)

  const handleStopSession = async () => {
    if (!confirm("Are you sure you want to end this server session? All GPU and RAM resources will be freed.")) {
      return
    }
    setStopping(true)
    let tk = token || searchParams.get('token')
    if (!tk && url && url.includes('token=')) {
      tk = url.split('token=')[1].split('&')[0]
    }
    try {
      const res = await fetch(`${BACKEND_URL}/stop-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tk })
      })
      if (res.ok) {
        setLaunched(false)
        setUrl('')
        setToken('')
        setMessage('Server stopped successfully. Hardware resources have been returned to pool.')
      } else {
        alert('Failed to terminate session')
      }
    } catch {
      alert('Failed to reach backend')
    } finally {
      setStopping(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#fcfcfd] text-gray-900 flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-gray-200/80 px-4 sm:px-6 h-14 flex justify-between items-center shrink-0 shadow-xs">
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
          <Link href="/jupyter" className="px-3 py-1.5 text-[#bb432c] border-b-2 border-[#bb432c] font-semibold">
            Workspace
          </Link>
          <Link href="/host" className="px-3 py-1.5 hover:text-gray-900 transition-colors rounded hover:bg-gray-100/80">
            Host a Node
          </Link>
        </nav>
      </header>

      {!launched ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-md w-full shadow-xs space-y-5">
            <div className="text-center space-y-1">
              <h2 className="text-xl font-bold text-gray-900">Connect to Workspace</h2>
              <p className="text-gray-600 text-xs">
                Enter your server access token to start or reconnect to your JupyterLab container.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                Access Token
              </label>
              <input
                id="token-input"
                type="text"
                placeholder="Paste session token..."
                value={token}
                onChange={e => setToken(e.target.value)}
                disabled={loading}
                className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#bb432c] focus:ring-1 focus:ring-[#bb432c] font-mono text-xs transition disabled:bg-gray-100"
              />
            </div>

            <button
              id="launch-btn"
              onClick={() => triggerLaunch()}
              disabled={loading || !token}
              className="w-full py-2.5 bg-[#bb432c] hover:bg-[#9c3622] text-white font-semibold text-sm rounded-lg shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>{PROGRESS_MESSAGES[progressIdx]}</span>
                </>
              ) : (
                <span>Launch Workspace</span>
              )}
            </button>

            {loading && (
              <div className="bg-gray-50 border border-gray-200/80 rounded-lg p-3 text-xs text-gray-600 space-y-1">
                <div className="font-semibold text-gray-800">Connection Status:</div>
                <p>Node Reserved</p>
                <p className={progressIdx >= 1 ? 'font-medium text-gray-900' : 'text-gray-400'}>
                  {progressIdx >= 1 ? 'Starting Container...' : 'Container initialization'}
                </p>
                <p className={progressIdx >= 4 ? 'font-medium text-gray-900' : 'text-gray-400'}>
                  {progressIdx >= 4 ? 'Establishing secure tunnel...' : 'Network tunnel'}
                </p>
                <p className="text-[11px] text-gray-400 italic pt-1">
                  Note: Initial image pull may take 1-2 minutes.
                </p>
              </div>
            )}

            {message && (
              <div className={`p-3 rounded-lg text-xs text-center border font-medium ${
                message.includes('successfully')
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}>
                {message}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {/* Active Session Bar */}
          <div className="px-4 py-2 bg-white border-b border-gray-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
              <span className="text-xs font-mono text-gray-600 truncate max-w-md">{url}</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-300 px-3 py-1.5 rounded transition font-medium flex items-center gap-1"
              >
                <span>Open in New Window</span>
              </a>
              <button
                onClick={handleStopSession}
                disabled={stopping}
                className="text-xs bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 px-3 py-1.5 rounded transition font-medium disabled:opacity-50 cursor-pointer"
              >
                {stopping ? 'Stopping...' : 'Stop Server'}
              </button>
            </div>
          </div>

          <iframe
            src={url}
            className="flex-1 w-full border-0 bg-white"
            title="Jupyter Workspace"
          />
        </div>
      )}
    </main>
  )
}

export default function JupyterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f8f9fa] text-gray-900 flex items-center justify-center text-sm font-medium">Loading workspace…</div>}>
      <JupyterWorkspace />
    </Suspense>
  )
}
