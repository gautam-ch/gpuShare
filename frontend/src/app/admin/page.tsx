'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRequireAdmin, useAuth } from '../context/AuthContext'
import { useRouter } from 'next/navigation'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardMachine {
  id: string
  tailscale_ip: string
  vram_total_mb: number
  vram_free_mb: number
  vram_used_mb: number
  cpus: number
  shared_ram_gb: number
  gpu_utilization_percent: number
  status: 'online' | 'offline'
  last_heartbeat_seconds_ago: number | null
}

interface ActiveSession {
  job_id: number
  user_email: string
  machine_id: string
  machine_ip: string | null
  gpu_utilization_percent: number | null
  vram_required_mb: number
  cpu_cores: number
  ram_gb: number
  status: string
  jupyter_url: string | null
  started_seconds_ago: number | null
}

interface DashboardStats {
  total_machines: number
  online_machines: number
  offline_machines: number
  active_sessions: number
  total_users: number
  total_vram_mb: number
  free_vram_mb: number
  used_vram_mb: number
}

interface ClusterUser {
  id: string
  email: string
  is_admin: boolean
  is_active: boolean
  max_vram_gb: number
  max_cpu_cores: number
  max_ram_gb: number
  created_at: string | null
  active_session: {
    job_id: number
    status: string
    machine_id: string
    vram_required_mb: number
    cpu_cores: number
    ram_gb: number
    jupyter_url: string | null
    started_seconds_ago: number | null
  } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(s: number | null): string {
  if (s === null) return 'N/A'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`
}

function fmtDur(s: number | null): string {
  if (s === null) return 'N/A'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function VramBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0
  const color = pct > 80 ? '#dc2626' : pct > 50 ? '#d97706' : '#16a34a'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div style={{ width: `${pct}%`, backgroundColor: color }} className="h-full rounded-full transition-all" />
      </div>
      <span className="text-[10px] font-mono text-gray-500 shrink-0">{Math.round(used)}/{Math.round(total)} MB</span>
    </div>
  )
}

function GpuBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-gray-400">—</span>
  const color = pct > 80 ? '#dc2626' : pct > 40 ? '#d97706' : '#16a34a'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} className="h-full rounded-full" />
      </div>
      <span className="text-[10px] font-mono text-gray-600">{pct.toFixed(0)}%</span>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    online: 'bg-green-500', done: 'bg-blue-500', running: 'bg-blue-500',
    assigned: 'bg-amber-500', pending: 'bg-amber-500', offline: 'bg-gray-400',
    error: 'bg-red-500', stopped: 'bg-gray-400', stopping: 'bg-gray-400',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium`}>
      <span className={`w-1.5 h-1.5 rounded-full ${map[status] || 'bg-gray-400'}`} />
      {status}
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = 'overview' | 'machines' | 'sessions' | 'users'

export default function AdminDashboard() {
  const { user, loading: authLoading } = useRequireAdmin()
  const { token: jwtToken, logout } = useAuth()
  const router = useRouter()

  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [machines, setMachines] = useState<DashboardMachine[]>([])
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [users, setUsers] = useState<ClusterUser[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // User management form state
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', password: '', max_vram_gb: 2, max_cpu_cores: 2, max_ram_gb: 4, is_admin: false })
  const [editingUser, setEditingUser] = useState<ClusterUser | null>(null)
  const [editQuota, setEditQuota] = useState({ max_vram_gb: 2, max_cpu_cores: 2, max_ram_gb: 4 })
  const [actionMsg, setActionMsg] = useState('')

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}),
  }), [jwtToken])

  const fetchAll = useCallback(async () => {
    if (!jwtToken) return
    try {
      const [dashRes, usersRes] = await Promise.all([
        fetch(`${BACKEND_URL}/admin/dashboard`, { headers: authHeaders() }),
        fetch(`${BACKEND_URL}/admin/users`, { headers: authHeaders() }),
      ])
      if (dashRes.ok) {
        const d = await dashRes.json()
        setStats(d.stats)
        setMachines(d.machines)
        setSessions(d.active_sessions)
      }
      if (usersRes.ok) {
        setUsers(await usersRes.json())
      }
      setLastRefresh(new Date())
    } catch (e) {
      console.error('Dashboard fetch failed:', e)
    } finally {
      setDataLoading(false)
    }
  }, [jwtToken, authHeaders])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 10000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const terminateSession = async (jobId: number) => {
    await fetch(`${BACKEND_URL}/admin/sessions/${jobId}/terminate`, {
      method: 'POST', headers: authHeaders()
    })
    setActionMsg(`Session #${jobId} terminated`)
    fetchAll()
  }

  const createUser = async () => {
    const res = await fetch(`${BACKEND_URL}/admin/users`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(newUser),
    })
    if (res.ok) {
      setShowCreateUser(false)
      setNewUser({ email: '', password: '', max_vram_gb: 2, max_cpu_cores: 2, max_ram_gb: 4, is_admin: false })
      setActionMsg('User created successfully')
      fetchAll()
    } else {
      const err = await res.json()
      setActionMsg(`Error: ${err.detail}`)
    }
  }

  const saveUserQuota = async () => {
    if (!editingUser) return
    await fetch(`${BACKEND_URL}/admin/users/${editingUser.id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(editQuota),
    })
    setEditingUser(null)
    setActionMsg('User quota updated')
    fetchAll()
  }

  const toggleUserActive = async (u: ClusterUser) => {
    await fetch(`${BACKEND_URL}/admin/users/${u.id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ is_active: !u.is_active }),
    })
    setActionMsg(`User ${u.is_active ? 'deactivated' : 'activated'}`)
    fetchAll()
  }

  const deleteUser = async (u: ClusterUser) => {
    if (!confirm(`Delete ${u.email}? This will terminate their active session.`)) return
    await fetch(`${BACKEND_URL}/admin/users/${u.id}`, { method: 'DELETE', headers: authHeaders() })
    setActionMsg(`User ${u.email} deleted`)
    fetchAll()
  }

  const handleLogout = () => { logout(); router.replace('/login') }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-[#bb432c] border-t-transparent animate-spin" />
      </div>
    )
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'machines', label: 'Machines', count: machines.length },
    { id: 'sessions', label: 'Active Sessions', count: sessions.length },
    { id: 'users', label: 'Users', count: users.length },
  ]

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-gray-900">
      {/* Nav */}
      <header className="bg-white border-b border-gray-200/80 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <svg className="w-7 h-7" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="7" fill="#111827" />
                <path d="M8 8L16 16L8 24" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
                <path d="M14 8L22 16L14 24" stroke="#bb432c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="23.5" cy="16" r="2" fill="#bb432c" />
              </svg>
              <span className="font-bold text-lg tracking-tight">Kinetic</span>
            </Link>
            <span className="text-gray-300">·</span>
            <span className="text-sm font-semibold text-gray-600">Admin Console</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">Last refresh: {lastRefresh.toLocaleTimeString()}</span>
            <button onClick={fetchAll} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition">↻ Refresh</button>
            <button onClick={handleLogout} className="text-xs px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">Sign out</button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

        {/* Action message */}
        {actionMsg && (
          <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
            {actionMsg}
            <button onClick={() => setActionMsg('')} className="text-emerald-600 hover:text-emerald-900">✕</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
                tab === t.id ? 'border-[#bb432c] text-[#bb432c]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${tab === t.id ? 'bg-[#bb432c]/10 text-[#bb432c]' : 'bg-gray-100 text-gray-500'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {tab === 'overview' && stats && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Online Machines', value: `${stats.online_machines} / ${stats.total_machines}`, sub: `${stats.offline_machines} offline`, color: stats.online_machines > 0 ? 'text-green-600' : 'text-gray-500' },
                { label: 'Active Sessions', value: stats.active_sessions, sub: 'running now', color: 'text-blue-600' },
                { label: 'Total Users', value: stats.total_users, sub: 'registered', color: 'text-gray-900' },
                { label: 'VRAM Used', value: `${Math.round(stats.used_vram_mb / 1024 * 10) / 10} GB`, sub: `of ${Math.round(stats.total_vram_mb / 1024 * 10) / 10} GB total`, color: 'text-[#bb432c]' },
              ].map(card => (
                <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">{card.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{card.sub}</div>
                </div>
              ))}
            </div>

            {/* VRAM overview bar */}
            {stats.total_vram_mb > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
                <div className="flex justify-between text-sm font-medium text-gray-700">
                  <span>Cluster VRAM Utilization</span>
                  <span>{Math.round(stats.used_vram_mb / stats.total_vram_mb * 100)}%</span>
                </div>
                <VramBar used={stats.used_vram_mb} total={stats.total_vram_mb} />
              </div>
            )}

            {/* Quick shortcuts */}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setTab('users')} className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-[#bb432c]/30 hover:bg-[#bb432c]/5 transition group">
                <div className="text-sm font-semibold text-gray-900 group-hover:text-[#bb432c]">Manage Users →</div>
                <div className="text-xs text-gray-500 mt-0.5">Create users, set quotas, deactivate accounts</div>
              </button>
              <button onClick={() => setTab('sessions')} className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-[#bb432c]/30 hover:bg-[#bb432c]/5 transition group">
                <div className="text-sm font-semibold text-gray-900 group-hover:text-[#bb432c]">View Sessions →</div>
                <div className="text-xs text-gray-500 mt-0.5">Monitor active workloads, GPU activity, terminate</div>
              </button>
            </div>
          </div>
        )}

        {/* ── MACHINES TAB ── */}
        {tab === 'machines' && (
          <div className="space-y-3">
            {machines.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">No machines registered yet.</div>
            ) : machines.map(m => (
              <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusDot status={m.status} />
                      <span className="text-xs text-gray-500 font-mono">{m.id}</span>
                    </div>
                    <div className="text-xs text-gray-500">IP: <span className="font-mono">{m.tailscale_ip}</span> · CPUs: {m.cpus} · RAM: {m.shared_ram_gb} GB</div>
                    <div className="text-[11px] text-gray-400">Heartbeat: {fmt(m.last_heartbeat_seconds_ago)}</div>
                  </div>
                  <div className="space-y-2 min-w-[200px]">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">VRAM</div>
                    <VramBar used={m.vram_used_mb} total={m.vram_total_mb} />
                    <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold mt-1">GPU Utilization</div>
                    <GpuBar pct={m.gpu_utilization_percent} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── SESSIONS TAB ── */}
        {tab === 'sessions' && (
          <div className="space-y-3">
            {sessions.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">No active sessions.</div>
            ) : sessions.map(s => (
              <div key={s.job_id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusDot status={s.status} />
                    <span className="text-xs font-semibold text-gray-900">{s.user_email}</span>
                    <span className="text-[10px] text-gray-400 font-mono">job #{s.job_id}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    Machine: <span className="font-mono">{s.machine_id}</span> · {s.vram_required_mb} MB VRAM · {s.cpu_cores} CPUs · {s.ram_gb} GB RAM
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-gray-400">Running: {fmtDur(s.started_seconds_ago)}</span>
                    <GpuBar pct={s.gpu_utilization_percent} />
                  </div>
                  {s.jupyter_url && (
                    <a href={s.jupyter_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline truncate block">
                      {s.jupyter_url}
                    </a>
                  )}
                </div>
                <button
                  onClick={() => terminateSession(s.job_id)}
                  className="shrink-0 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 text-xs font-semibold rounded-lg transition"
                >
                  Terminate
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── USERS TAB ── */}
        {tab === 'users' && (
          <div className="space-y-4">
            {/* Create user button */}
            <div className="flex justify-end">
              <button
                onClick={() => setShowCreateUser(!showCreateUser)}
                className="px-4 py-2 bg-[#bb432c] hover:bg-[#a33a25] text-white text-sm font-semibold rounded-lg transition"
              >
                {showCreateUser ? 'Cancel' : '+ Create User'}
              </button>
            </div>

            {/* Create user form */}
            {showCreateUser && (
              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-gray-900">New User</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Email</label>
                    <input type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#bb432c]/30" placeholder="user@example.com" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Password</label>
                    <input type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#bb432c]/30" placeholder="••••••••" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Max VRAM (GB)</label>
                    <input type="number" min={1} max={80} value={newUser.max_vram_gb} onChange={e => setNewUser(p => ({ ...p, max_vram_gb: +e.target.value }))}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#bb432c]/30" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Max CPU Cores</label>
                    <input type="number" min={1} max={64} value={newUser.max_cpu_cores} onChange={e => setNewUser(p => ({ ...p, max_cpu_cores: +e.target.value }))}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#bb432c]/30" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Max RAM (GB)</label>
                    <input type="number" min={1} max={128} value={newUser.max_ram_gb} onChange={e => setNewUser(p => ({ ...p, max_ram_gb: +e.target.value }))}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#bb432c]/30" />
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <input type="checkbox" id="is_admin" checked={newUser.is_admin} onChange={e => setNewUser(p => ({ ...p, is_admin: e.target.checked }))} className="accent-[#bb432c]" />
                    <label htmlFor="is_admin" className="text-xs font-semibold text-gray-600">Grant admin access</label>
                  </div>
                </div>
                <button onClick={createUser} className="px-5 py-2 bg-[#bb432c] hover:bg-[#a33a25] text-white text-sm font-semibold rounded-lg transition">
                  Create User
                </button>
              </div>
            )}

            {/* User list */}
            {users.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">No users yet.</div>
            ) : users.map(u => (
              <div key={u.id} className={`bg-white border rounded-xl p-4 space-y-2 ${u.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{u.email}</span>
                      {u.is_admin && <span className="px-1.5 py-0.5 bg-[#bb432c]/10 text-[#bb432c] text-[10px] font-bold rounded">Admin</span>}
                      {!u.is_active && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-bold rounded">Inactive</span>}
                    </div>
                    <div className="text-xs text-gray-500 font-mono">
                      Quota: {u.max_vram_gb}GB VRAM · {u.max_cpu_cores} CPU · {u.max_ram_gb}GB RAM
                    </div>
                    {u.active_session ? (
                      <div className="text-xs text-blue-600">
                        Session #{u.active_session.job_id} · {u.active_session.status} · {fmtDur(u.active_session.started_seconds_ago)}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">No active session</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => { setEditingUser(u); setEditQuota({ max_vram_gb: u.max_vram_gb, max_cpu_cores: u.max_cpu_cores, max_ram_gb: u.max_ram_gb }) }}
                      className="px-3 py-1.5 text-xs font-semibold border border-gray-200 hover:border-gray-300 rounded-lg transition"
                    >
                      Edit Quota
                    </button>
                    <button
                      onClick={() => toggleUserActive(u)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${u.is_active ? 'border-amber-200 text-amber-700 hover:bg-amber-50' : 'border-green-200 text-green-700 hover:bg-green-50'}`}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => deleteUser(u)}
                      className="px-3 py-1.5 text-xs font-semibold border border-red-200 text-red-700 hover:bg-red-50 rounded-lg transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Inline quota editor */}
                {editingUser?.id === u.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-3">
                    {(['max_vram_gb', 'max_cpu_cores', 'max_ram_gb'] as const).map(key => (
                      <div key={key}>
                        <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                          {key === 'max_vram_gb' ? 'VRAM (GB)' : key === 'max_cpu_cores' ? 'CPU Cores' : 'RAM (GB)'}
                        </label>
                        <input
                          type="number" min={1}
                          value={editQuota[key]}
                          onChange={e => setEditQuota(p => ({ ...p, [key]: +e.target.value }))}
                          className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#bb432c]/30"
                        />
                      </div>
                    ))}
                    <div className="col-span-3 flex gap-2">
                      <button onClick={saveUserQuota} className="px-4 py-1.5 bg-[#bb432c] text-white text-xs font-semibold rounded-lg hover:bg-[#a33a25] transition">Save</button>
                      <button onClick={() => setEditingUser(null)} className="px-4 py-1.5 border border-gray-200 text-xs font-semibold rounded-lg hover:bg-gray-50 transition">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
