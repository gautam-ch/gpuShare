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
  const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{
        flex: 1, height: '6px', background: 'rgba(255,255,255,0.1)',
        borderRadius: '3px', overflow: 'hidden'
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: color, borderRadius: '3px',
          transition: 'width 0.5s ease'
        }} />
      </div>
      <span style={{ fontSize: '11px', color: '#94a3b8', minWidth: '80px' }}>
        {Math.round(used)}MB / {Math.round(total)}MB
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string; dot: string }> = {
    online:   { bg: 'rgba(16,185,129,0.15)', color: '#10b981', dot: '#10b981' },
    offline:  { bg: 'rgba(100,116,139,0.15)', color: '#64748b', dot: '#64748b' },
    done:     { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', dot: '#818cf8' },
    pending:  { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', dot: '#fbbf24' },
    assigned: { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', dot: '#fbbf24' },
    error:    { bg: 'rgba(239,68,68,0.15)', color: '#f87171', dot: '#f87171' },
  }
  const c = colors[status] || colors.offline
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 10px', borderRadius: '999px',
      background: c.bg, color: c.color, fontSize: '12px', fontWeight: 600
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: c.dot,
        boxShadow: status === 'online' ? `0 0 6px ${c.dot}` : 'none',
        animation: status === 'online' ? 'pulse 2s infinite' : 'none'
      }} />
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
    const interval = setInterval(fetchAll, 5000) // auto-refresh every 5s
    return () => clearInterval(interval)
  }, [fetchAll])

  const activeJobs = jobs.filter(j => ['pending', 'assigned', 'done'].includes(j.status) && j.jupyter_url)
  const recentJobs = jobs.slice(0, 20)

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #030712 0%, #0f172a 50%, #1e1b4b 100%)',
      color: '#e2e8f0',
      fontFamily: "'Inter', -apple-system, sans-serif",
      padding: '0',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .card { animation: fadeIn 0.4s ease forwards; }
        .row-hover:hover { background: rgba(255,255,255,0.04) !important; transition: background 0.2s; }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '16px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link href="/" style={{ color: '#64748b', textDecoration: 'none', fontSize: '14px' }}>← Back</Link>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '16px'
            }}>⚡</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>Admin Dashboard</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>GPU Share Hub</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '12px', color: '#475569' }}>
            Auto-refresh: 5s · Last: {lastRefresh.toLocaleTimeString()}
          </div>
          <button
            onClick={fetchAll}
            style={{
              background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: '8px', padding: '6px 14px', color: '#818cf8',
              cursor: 'pointer', fontSize: '13px', fontWeight: 500
            }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      <div style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto' }}>

        {/* Stats Bar */}
        {stats && (
          <div className="card" style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '16px', marginBottom: '32px'
          }}>
            {[
              { label: 'Online Machines', value: stats.online_machines, sub: `/ ${stats.total_machines} total`, color: '#10b981', icon: '🖥️' },
              { label: 'Active Renters', value: stats.active_renters, sub: 'live sessions', color: '#6366f1', icon: '👤' },
              { label: 'Total VRAM', value: `${Math.round(stats.total_vram_mb / 1024)}GB`, sub: 'across live machines', color: '#f59e0b', icon: '💾' },
              { label: 'VRAM In Use', value: `${Math.round(stats.used_vram_mb / 1024 * 10) / 10}GB`, sub: `${Math.round(stats.free_vram_mb / 1024 * 10) / 10}GB free`, color: '#8b5cf6', icon: '⚡' },
            ].map(s => (
              <div key={s.label} style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '16px', padding: '20px',
                position: 'relative', overflow: 'hidden'
              }}>
                <div style={{
                  position: 'absolute', top: '-10px', right: '-10px',
                  width: '60px', height: '60px', borderRadius: '50%',
                  background: `${s.color}15`
                }} />
                <div style={{ fontSize: '22px', marginBottom: '8px' }}>{s.icon}</div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1', marginTop: '2px' }}>{s.label}</div>
                <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{s.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Machines Table */}
        <div className="card" style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '16px', marginBottom: '24px', overflow: 'hidden'
        }}>
          <div style={{
            padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>🖥️ Provider Machines</div>
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                {machines.filter(m => m.status === 'online').length} online · {machines.length} total registered
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#475569' }}>Loading...</div>
          ) : machines.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#475569' }}>
              No machines registered yet. Share the install script with GPU providers!
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Machine ID', 'Status', 'Tailscale IP', 'CPU Cores', 'VRAM Usage', 'Last Heartbeat'].map(h => (
                    <th key={h} style={{
                      padding: '12px 24px', textAlign: 'left',
                      fontSize: '11px', fontWeight: 600,
                      color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {machines.map(m => (
                  <tr key={m.id} className="row-hover" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{
                        fontFamily: 'monospace', fontSize: '13px',
                        background: 'rgba(255,255,255,0.05)', padding: '3px 8px',
                        borderRadius: '6px', color: '#94a3b8'
                      }}>{m.id}</span>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <StatusBadge status={m.status} />
                    </td>
                    <td style={{ padding: '16px 24px', fontFamily: 'monospace', fontSize: '13px', color: '#94a3b8' }}>
                      {m.tailscale_ip || '—'}
                    </td>
                    <td style={{ padding: '16px 24px', color: '#94a3b8', fontSize: '14px' }}>
                      {m.cpus || '—'}
                    </td>
                    <td style={{ padding: '16px 24px', minWidth: '220px' }}>
                      <VramBar used={m.vram_used_mb} total={m.vram_total_mb} />
                    </td>
                    <td style={{ padding: '16px 24px', color: '#475569', fontSize: '13px' }}>
                      {m.status === 'online'
                        ? <span style={{ color: '#10b981' }}>{formatSeconds(m.last_heartbeat_seconds_ago)}</span>
                        : formatSeconds(m.last_heartbeat_seconds_ago)
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Jobs Table */}
        <div className="card" style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '16px', overflow: 'hidden'
        }}>
          <div style={{
            padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>⚡ Recent Jobs</div>
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                {activeJobs.length} active · Last 20 jobs shown
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#475569' }}>Loading...</div>
          ) : recentJobs.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#475569' }}>
              No jobs yet. Rent a GPU to see activity here!
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Job ID', 'Machine', 'Status', 'Resources', 'VRAM', 'Duration', 'Jupyter Link'].map(h => (
                    <th key={h} style={{
                      padding: '12px 24px', textAlign: 'left',
                      fontSize: '11px', fontWeight: 600,
                      color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentJobs.map(j => (
                  <tr key={j.id} className="row-hover" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{
                        fontFamily: 'monospace', fontSize: '13px',
                        background: 'rgba(255,255,255,0.05)', padding: '3px 8px',
                        borderRadius: '6px', color: '#94a3b8'
                      }}>#{j.id}</span>
                    </td>
                    <td style={{ padding: '16px 24px', fontFamily: 'monospace', fontSize: '12px', color: '#64748b' }}>
                      {j.machine_id || '—'}
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <StatusBadge status={j.status} />
                    </td>
                    <td style={{ padding: '16px 24px', fontSize: '13px', color: '#94a3b8' }}>
                      {j.cpu_cores ?? '?'}CPU · {j.ram_gb ?? '?'}GB RAM
                    </td>
                    <td style={{ padding: '16px 24px', fontSize: '13px', color: '#94a3b8' }}>
                      {j.vram_required_mb ? `${Math.round(j.vram_required_mb)}MB` : '—'}
                    </td>
                    <td style={{ padding: '16px 24px', fontSize: '13px', color: '#64748b' }}>
                      {formatDuration(j.started_seconds_ago)}
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      {j.jupyter_url ? (
                        <a
                          href={j.jupyter_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: '#818cf8', fontSize: '12px',
                            textDecoration: 'none',
                            background: 'rgba(99,102,241,0.1)',
                            border: '1px solid rgba(99,102,241,0.2)',
                            padding: '4px 10px', borderRadius: '6px',
                            display: 'inline-flex', alignItems: 'center', gap: '4px'
                          }}
                        >
                          Open ↗
                        </a>
                      ) : (
                        <span style={{ color: '#475569', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
