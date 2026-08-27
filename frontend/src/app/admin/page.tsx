'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

interface Machine {
  id: string
  tailscale_ip: string
  vram_total_mb: number
  vram_free_mb: number
  vram_used_mb: number
  cpus: number
  status: 'online' | 'offline'
  last_heartbeat_seconds_ago: number | null
}

interface Job {
  id: number
  machine_id: string
  status: string
  vram_required_mb: number
  cpu_cores: number
  ram_gb: number
  jupyter_url: string | null
  started_at: string | null
  started_seconds_ago: number | null
}

interface Stats {
  total_machines: number
  online_machines: number
  offline_machines: number
  active_renters: number
  total_vram_mb: number
  free_vram_mb: number
  used_vram_mb: number
}

function formatSeconds(s: number | null): string {
  if (s === null) return 'N/A'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function formatDuration(s: number | null): string {
  if (s === null) return 'N/A'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function VramBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0
  const color = pct > 80 ? '#dc2626' : pct > 50 ? '#d97706' : '#16a34a'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          style={{ width: `${pct}%`, backgroundColor: color }}
          className="h-full rounded-full transition-all duration-300"
        />
      </div>
      <span className="text-xs font-mono text-gray-600 min-w-[90px]">
        {Math.round(used)} / {Math.round(total)} MB
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const isOnline = status === 'online'
  const isDone = status === 'done'
  const isError = status === 'error'
  const isPending = status === 'pending' || status === 'assigned'

  let badgeClass = 'bg-gray-100 text-gray-700 border-gray-200'
  let dotClass = 'bg-gray-400'

  if (isOnline) {
    badgeClass = 'bg-green-50 text-green-800 border-green-200'
    dotClass = 'bg-green-500'
  } else if (isDone) {
    badgeClass = 'bg-blue-50 text-blue-800 border-blue-200'
    dotClass = 'bg-blue-500'
  } else if (isPending) {
    badgeClass = 'bg-amber-50 text-amber-800 border-amber-200'
    dotClass = 'bg-amber-500'
  } else if (isError) {
    badgeClass = 'bg-red-50 text-red-800 border-red-200'
    dotClass = 'bg-red-500'
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium border ${badgeClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [authError, setAuthError] = useState('')

  const [machines, setMachines] = useState<Machine[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAuth = sessionStorage.getItem('gpu_admin_auth')
      if (savedAuth === 'true') {
        setIsAuthenticated(true)
      }
    }
  }, [])

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (passwordInput === '123456') {
      setIsAuthenticated(true)
      setAuthError('')
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('gpu_admin_auth', 'true')
      }
    } else {
      setAuthError('Incorrect password. Please try again.')
    }
  }

  const handleLogout = () => {
    setIsAuthenticated(false)
    setPasswordInput('')
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('gpu_admin_auth')
    }
  }

  const fetchAll = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      const [mRes, jRes, sRes] = await Promise.all([
        fetch(`${BACKEND_URL}/admin/machines`),
        fetch(`${BACKEND_URL}/admin/jobs`),
        fetch(`${BACKEND_URL}/admin/stats`),
      ])
      if (mRes.ok) setMachines(await mRes.json())
      if (jRes.ok) setJobs(await jRes.json())
      if (sRes.ok) setStats(await sRes.json())
      setLastRefresh(new Date())
    } catch (e) {
      console.error('Admin fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (isAuthenticated) {
      fetchAll()
      const interval = setInterval(fetchAll, 5000)
      return () => clearInterval(interval)
    }
  }, [fetchAll, isAuthenticated])

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#fcfcfd] text-gray-900 flex flex-col justify-center items-center px-4">
        <div className="bg-white border border-gray-200/80 rounded-xl p-8 max-w-md w-full shadow-xs space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#bb432c]/10 text-[#bb432c] mb-1">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Admin Authentication
            </h1>
            <p className="text-xs text-gray-500">
              Enter the administrator password to access the cluster control panel.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                Admin Password
              </label>
              <input
                type="password"
                placeholder="Enter password..."
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#bb432c] focus:ring-1 focus:ring-[#bb432c] font-mono text-sm transition"
              />
            </div>

            {authError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium text-center">
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 bg-[#bb432c] hover:bg-[#9c3622] text-white font-semibold text-sm rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              Sign In
            </button>
          </form>

          <div className="text-center pt-2 border-t border-gray-100">
            <Link href="/" className="text-xs text-gray-500 hover:text-gray-900 transition">
              ← Return to Rent Page
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const activeJobs = jobs.filter(j => ['pending', 'assigned', 'done'].includes(j.status) && j.jupyter_url)
  const recentJobs = jobs.slice(0, 20)

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-gray-900 flex flex-col">
      {/* Admin Header */}
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

        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 hidden sm:inline">
            Auto-refresh: 5s · Last: {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={fetchAll}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 text-xs font-medium rounded-md transition cursor-pointer"
          >
            Refresh
          </button>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-medium rounded-md transition cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Admin Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Quick Stats Grid */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200/80 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Online Machines</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{stats.online_machines} <span className="text-xs font-normal text-gray-500">/ {stats.total_machines}</span></div>
            </div>
            <div className="bg-white border border-gray-200/80 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Active Workspaces</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{stats.active_renters}</div>
            </div>
            <div className="bg-white border border-gray-200/80 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total VRAM Mesh</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{(stats.total_vram_mb / 1024).toFixed(1)} GB</div>
            </div>
            <div className="bg-white border border-gray-200/80 rounded-xl p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">VRAM In Use</div>
              <div className="text-2xl font-bold text-[#bb432c] mt-1">{(stats.used_vram_mb / 1024).toFixed(1)} GB</div>
            </div>
          </div>
        )}

        {/* Machines Table */}
        <div className="bg-white border border-gray-200/80 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-gray-200/80 bg-gray-50/80 flex items-center justify-between">
            <div className="font-semibold text-sm text-gray-900">
              Registered Provider Nodes ({machines.length})
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading nodes...</div>
          ) : machines.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              No nodes registered. Run the host agent to onboard a GPU.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50 text-gray-600 uppercase tracking-wider font-semibold">
                    <th className="py-2.5 px-4">Node ID</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Tailscale IP</th>
                    <th className="py-2.5 px-4">CPUs</th>
                    <th className="py-2.5 px-4 min-w-[220px]">VRAM Allocation</th>
                    <th className="py-2.5 px-4">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {machines.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-gray-900">{m.id}</td>
                      <td className="py-3 px-4"><StatusBadge status={m.status} /></td>
                      <td className="py-3 px-4 font-mono text-gray-600">{m.tailscale_ip || '—'}</td>
                      <td className="py-3 px-4 text-gray-700">{m.cpus || '—'} Cores</td>
                      <td className="py-3 px-4">
                        <VramBar used={m.vram_used_mb} total={m.vram_total_mb} />
                      </td>
                      <td className="py-3 px-4 text-gray-500">
                        {formatSeconds(m.last_heartbeat_seconds_ago)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sessions / Jobs Table */}
        <div className="bg-white border border-gray-200/80 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-gray-200/80 bg-gray-50/80 flex items-center justify-between">
            <div className="font-semibold text-sm text-gray-900">
              Active & Recent Workspaces ({activeJobs.length} active)
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading jobs...</div>
          ) : recentJobs.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              No jobs dispatched yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50 text-gray-600 uppercase tracking-wider font-semibold">
                    <th className="py-2.5 px-4">Job ID</th>
                    <th className="py-2.5 px-4">Assigned Node</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Resources</th>
                    <th className="py-2.5 px-4">VRAM</th>
                    <th className="py-2.5 px-4">Uptime</th>
                    <th className="py-2.5 px-4">Notebook Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentJobs.map(j => (
                    <tr key={j.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-gray-800">#{j.id}</td>
                      <td className="py-3 px-4 font-mono text-gray-600">{j.machine_id || '—'}</td>
                      <td className="py-3 px-4"><StatusBadge status={j.status} /></td>
                      <td className="py-3 px-4 text-gray-700">{j.cpu_cores ?? '?'} CPU · {j.ram_gb ?? '?'} GB RAM</td>
                      <td className="py-3 px-4 font-mono text-gray-700">{j.vram_required_mb ? `${Math.round(j.vram_required_mb)} MB` : '—'}</td>
                      <td className="py-3 px-4 text-gray-500">{formatDuration(j.started_seconds_ago)}</td>
                      <td className="py-3 px-4">
                        {j.jupyter_url ? (
                          <a
                            href={j.jupyter_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[#bb432c] hover:text-[#9c3622] font-medium underline"
                          >
                            Open
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
