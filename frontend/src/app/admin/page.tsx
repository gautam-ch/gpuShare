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
  const [machines, setMachines] = useState<Machine[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 5000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const activeJobs = jobs.filter(j => ['pending', 'assigned', 'done'].includes(j.status) && j.jupyter_url)
  const recentJobs = jobs.slice(0, 20)

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
              JupyterHub <span className="font-normal text-gray-500">/ Control Panel</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 hidden sm:inline">
            Auto-refresh: 5s · Last: {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={fetchAll}
            className="text-xs bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-2.5 py-1.5 rounded transition font-medium cursor-pointer"
          >
            ↻ Refresh
          </button>
          <div className="w-px h-5 bg-gray-200" />
          <nav className="flex items-center gap-2 text-sm font-medium text-gray-600">
            <Link href="/" className="px-2.5 py-1 hover:text-gray-900 transition-colors rounded hover:bg-gray-100">
              Spawner
            </Link>
            <Link href="/jupyter" className="px-2.5 py-1 hover:text-gray-900 transition-colors rounded hover:bg-gray-100">
              Workspace
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Stats Row */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Online Nodes</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {stats.online_machines} <span className="text-xs text-gray-400 font-normal">/ {stats.total_machines} total</span>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Active Sessions</div>
              <div className="text-2xl font-bold text-orange-600 mt-1">
                {stats.active_renters}
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Total Cluster VRAM</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {Math.round(stats.total_vram_mb / 1024)} GB
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">VRAM In Use</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {Math.round(stats.used_vram_mb / 1024 * 10) / 10} GB
                <span className="text-xs text-gray-400 font-normal ml-1">({Math.round(stats.free_vram_mb / 1024 * 10) / 10} GB free)</span>
              </div>
            </div>
          </div>
        )}

        {/* Nodes Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <div className="font-semibold text-sm text-gray-900">
              Provider Nodes ({machines.filter(m => m.status === 'online').length} online / {machines.length} registered)
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading nodes…</div>
          ) : machines.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              No worker nodes registered yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50 text-gray-600 uppercase tracking-wider font-semibold">
                    <th className="py-2.5 px-4">Node ID</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Mesh IP</th>
                    <th className="py-2.5 px-4">CPUs</th>
                    <th className="py-2.5 px-4">VRAM Allocation</th>
                    <th className="py-2.5 px-4">Last Heartbeat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {machines.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono text-gray-800 font-medium">{m.id}</td>
                      <td className="py-3 px-4"><StatusBadge status={m.status} /></td>
                      <td className="py-3 px-4 font-mono text-gray-600">{m.tailscale_ip || '—'}</td>
                      <td className="py-3 px-4 text-gray-700">{m.cpus || '—'}</td>
                      <td className="py-3 px-4 min-w-[200px]">
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
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <div className="font-semibold text-sm text-gray-900">
              Active & Recent Workspaces ({activeJobs.length} active)
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading jobs…</div>
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
                            className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-medium underline"
                          >
                            Open ↗
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
