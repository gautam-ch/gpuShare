import React, { useState } from 'react'

export default function ActiveJobsTable({ activeContainers = [], clusterJobs = [], gpu = {}, activeContainersTelemetry = {}, onRefresh }) {
  const [terminating, setTerminating] = useState({})
  const hasWorkloads = activeContainers.length > 0 || clusterJobs.filter(j => j.status === 'done' || j.status === 'pending').length > 0

  const handleStopContainer = async (containerName) => {
    if (!window.confirm(`Are you sure you want to stop container "${containerName}" and reclaim all hardware?`)) {
      return
    }
    setTerminating(prev => ({ ...prev, [containerName]: true }))
    try {
      await fetch('/agent-api/stop-container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container_name: containerName })
      }).catch(() => fetch('http://localhost:9000/stop-container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container_name: containerName })
      }))
      setTimeout(() => {
        setTerminating(prev => ({ ...prev, [containerName]: false }))
        onRefresh?.()
      }, 1000)
    } catch {
      setTerminating(prev => ({ ...prev, [containerName]: false }))
    }
  }

  const handleStopAll = async () => {
    if (!window.confirm('Are you sure you want to terminate ALL running renter containers?')) {
      return
    }
    for (const c of activeContainers) {
      await handleStopContainer(c)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xs">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-gray-900">Active Renter Workload Pods</h3>
            <span className="px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-bold uppercase rounded">
              Hardware Sandboxed
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Docker containers executing isolated CUDA kernels and Jupyter workloads on your host
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeContainers.length > 0 && (
            <button
              onClick={handleStopAll}
              className="px-3 py-1 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded text-xs font-semibold shadow-2xs transition cursor-pointer"
            >
              Stop All Pods
            </button>
          )}
          <span className="px-3 py-1 bg-white border border-gray-300 rounded text-xs font-mono font-bold text-gray-800 shadow-2xs">
            {activeContainers.length} Running {activeContainers.length === 1 ? 'Pod' : 'Pods'}
          </span>
        </div>
      </div>

      {!hasWorkloads ? (
        <div className="p-10 text-center space-y-1.5 bg-white">
          <div className="w-10 h-10 mx-auto rounded-full bg-gray-100 flex items-center justify-center text-gray-400 font-mono text-xs font-bold">
            GPU
          </div>
          <p className="text-sm font-bold text-gray-800">No renter workloads currently executing</p>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            Your worker node is standing by in the cluster. When a customer rents and launches a notebook, container resource telemetry will stream here in real time.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/70 text-gray-600 uppercase tracking-wider font-semibold text-[11px]">
                <th className="py-3 px-4">Container Pod & Runtime</th>
                <th className="py-3 px-4">Workload Status</th>
                <th className="py-3 px-4">CUDA Activity</th>
                <th className="py-3 px-4">Hardware Isolation</th>
                <th className="py-3 px-4">Network & Tunnel</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {activeContainers.map((containerName) => {
                const tokenPrefix = containerName.replace('jupyter-', '')
                const matchingJob = clusterJobs.find(j => j.token && j.token.startsWith(tokenPrefix))

                const containerTelemetry = activeContainersTelemetry[containerName] || {}
                const liveVramMb = containerTelemetry.vram_mb !== undefined ? containerTelemetry.vram_mb : null
                const liveCpuCores = containerTelemetry.cpu_cores !== undefined ? containerTelemetry.cpu_cores : null
                const liveRamGb = containerTelemetry.ram_gb !== undefined ? containerTelemetry.ram_gb : null

                const allocatedVramMb = liveVramMb !== null ? liveVramMb : (gpu?.used_vram_mb || 630)
                const vramCapGb = matchingJob?.vram_required_mb ? (matchingJob.vram_required_mb / 1024).toFixed(1) : '2.0'
                const cpuCores = matchingJob?.cpu_cores || 4
                const ramGb = matchingJob?.ram_gb || 8
                const isStopping = terminating[containerName]

                return (
                  <tr key={containerName} className="hover:bg-orange-50/30 transition-colors">
                    <td className="py-3.5 px-4 font-mono">
                      <div className="font-bold text-gray-900 flex items-center gap-2">
                        <span>{containerName}</span>
                        <span className="px-1.5 py-0.2 bg-gray-100 text-gray-700 text-[10px] rounded font-mono">
                          PyTorch 2.x
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Image: quay.io/jupyter/pytorch-notebook:cuda12
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-green-50 text-green-800 border border-green-200 shadow-2xs">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        Active Kernel (Executing)
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-orange-600">
                        {allocatedVramMb >= 1024 ? `${(allocatedVramMb / 1024).toFixed(2)} GB` : `${Math.round(allocatedVramMb)} MB`} VRAM
                      </div>
                      <div className="text-[11px] text-gray-500 font-mono">
                        {liveVramMb !== null ? "Live VRAM Consumption" : "PyTorch Matrix Compute Active"}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-gray-700 font-mono">
                      <div className="font-semibold text-gray-900">
                        {vramCapGb} GB VRAM Cap • {cpuCores} Cores {liveCpuCores !== null && <span className="text-orange-600 font-bold">({liveCpuCores.toFixed(1)} Cores Live)</span>}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {ramGb} GB RAM Cap {liveRamGb !== null && <span className="text-blue-600 font-bold">({liveRamGb.toFixed(1)} GB Live)</span>}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-gray-600 font-mono text-[11px]">
                      <div className="flex items-center gap-1.5 text-gray-900 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        <span>Cloudflare WireGuard Quick Tunnel</span>
                      </div>
                      <div className="text-gray-400 mt-0.5 truncate max-w-[200px]">
                        Port 8888 · Token Authenticated
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => handleStopContainer(containerName)}
                        disabled={isStopping}
                        className="px-3 py-1.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded font-semibold text-xs transition cursor-pointer shadow-2xs disabled:opacity-50"
                      >
                        {isStopping ? 'Stopping...' : 'Stop Pod'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
