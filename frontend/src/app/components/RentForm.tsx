"use client"
import { useState } from 'react'

export default function RentForm() {
  const [vram, setVram] = useState('')
  const [message, setMessage] = useState('')
  const [token, setToken] = useState('')
  const [jupyterUrl, setJupyterUrl] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRent = async () => {
    if (!vram) return
    setLoading(true)
    setMessage('')
    try {
      const res = await fetch('http://localhost:8000/rent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vram_required: parseFloat(vram) })
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
    // Navigate to the Jupyter workspace page — it handles start + polling with a progress UI
    window.location.href = `/jupyter?token=${token}`
  }

  return (
    <section className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-4xl font-extrabold tracking-tight">
          Rent a <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500">GPU</span>
        </h2>
        <p className="text-slate-400 text-sm">Enter how much GPU memory you need. We'll find you a matching machine on the Tailnet.</p>
      </div>

      <div className="bg-slate-900 border border-white/10 rounded-xl p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-300">Required VRAM (GB)</span>
          <input
            id="vram-input"
            type="number"
            min="1"
            placeholder="e.g. 4"
            value={vram}
            onChange={e => setVram(e.target.value)}
            className="mt-2 block w-full rounded-lg bg-slate-800 border border-white/10 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
          />
        </label>

        <button
          id="rent-btn"
          onClick={handleRent}
          disabled={loading || !vram}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold transition-all"
        >
          {loading ? 'Finding machine…' : 'Rent GPU'}
        </button>

        {message && (
          <p className="text-sm text-center">{message}</p>
        )}

        {token && (
          <div className="border-t border-white/10 pt-4 space-y-3">
            <p className="text-xs text-slate-400 font-mono break-all">
              <span className="text-slate-200 font-semibold">Access Token:</span> {token}
            </p>
            <button
              id="launch-jupyter-btn"
              onClick={handleLaunch}
              disabled={loading}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg font-semibold transition-all"
            >
              🚀 Launch Jupyter Workspace
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
