import React, { useState } from 'react'

export default function ActiveJobsTable({ activeContainers = [], clusterJobs = [], gpu = {}, activeContainersTelemetry = {}, onRefresh }) {
  const [terminating, setTerminating] = useState({})
  const hasWorkloads = activeContainers.length > 0 || clusterJobs.filter(j => j.status === 'done' || j.status === 'pending').length > 0

  const handleStopContainer = async (containerName) => {
    if (!window.confirm(`Are you sure you want to stop container "${containerName}" and reclaim all hardware?`)) {
      return
    }
    setTerminating(prev => ({ ...prev, [containerName]: true }))
    const tokenPrefix = containerName.replace('jupyter-', '').slice(0, 8)

    try {
      const payload = JSON.stringify({ container_name: containerName })
      const postOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }

      // Send to local agent (via multiple routes for absolute reliability)
      await Promise.allSettled([
        fetch('/agent-api/stop-container', postOpts),
        fetch('http://127.0.0.1:9000/stop-container', postOpts),
        fetch('http://localhost:9000/stop-container', postOpts),
        // Also inform cluster backend so job record updates immediately
        fetch('/cluster-api/stop-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokenPrefix })
        }),
        fetch('http://127.0.0.1:8000/stop-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokenPrefix })
        })
      ])
    } catch (err) {
      console.warn('Error stopping pod:', err)
    } finally {
      setTimeout(() => {
        setTerminating(prev => ({ ...prev, [containerName]: false }))
        onRefresh?.()
      }, 500)
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
            Live VRAM · RAM · CPU per pod — updates every 2s · drops to 0 when kernel is killed
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
            Your worker node is standing by. When a customer rents and launches a notebook, live resource telemetry will stream here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {activeContainers.map((containerName) => {
            const tokenPrefix = containerName.replace('jupyter-', '')
            const matchingJob = clusterJobs.find(j => j.token && j.token.startsWith(tokenPrefix))
            const isStopping = terminating[containerName]

            // Live usage from nvidia-smi / docker stats — resets to 0 when kernel killed
            const tel = activeContainersTelemetry[containerName] || {}
            const liveVramMb   = typeof tel.vram_mb    === 'number' ? tel.vram_mb    : 0
            const liveCpuCores = typeof tel.cpu_cores  === 'number' ? tel.cpu_cores  : 0
            const liveRamGb    = typeof tel.ram_gb     === 'number' ? tel.ram_gb     : 0
            const hasLiveData  = Object.keys(tel).length > 0

            // Static allocation caps — what was reserved, never inflates after kernel kill
            const capVramGb   = matchingJob?.vram_gb   ?? (matchingJob?.vram_required_mb ? matchingJob.vram_required_mb / 1024 : 2.0)
            const capCpuCores = matchingJob?.cpu_cores ?? 4
            const capRamGb    = matchingJob?.ram_gb    ?? 8
            const capVramMb   = capVramGb * 1024

            const vramPct = capVramMb   > 0 ? Math.min(100, (liveVramMb   / capVramMb)   * 100) : 0
            const ramPct  = capRamGb    > 0 ? Math.min(100, (liveRamGb    / capRamGb)    * 100) : 0
            const cpuPct  = capCpuCores > 0 ? Math.min(100, (liveCpuCores / capCpuCores) * 100) : 0

            const vramColor = vramPct > 90 ? 'bg-red-500' : vramPct > 70 ? 'bg-orange-600' : 'bg-[#F37626]'
            const ramColor  = ramPct  > 90 ? 'bg-red-500' : 'bg-blue-500'
            const cpuColor  = cpuPct  > 90 ? 'bg-red-500' : cpuPct > 70 ? 'bg-green-600' : 'bg-green-500'

            return (
              <div key={containerName} className="p-5 hover:bg-gray-50/50 transition-colors">
                {/* Pod header */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center">
                        <span className="text-orange-600 text-[10px] font-bold font-mono">GPU</span>
                      </div>
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-white animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 font-mono text-sm font-bold text-gray-900">
                        {containerName}
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded font-mono">PyTorch 2.x</span>
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                        quay.io/jupyter/pytorch-notebook:cuda12 · Token: {tokenPrefix.slice(0, 8)}...
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-green-50 text-green-800 border border-green-200">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      {isStopping ? 'Terminating...' : 'Active Kernel (Executing)'}
                    </span>
                    {!hasLiveData && (
                      <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                        Awaiting telemetry...
                      </span>
                    )}
                    <button
                      onClick={() => handleStopContainer(containerName)}
                      disabled={isStopping}
                      className="px-3 py-1.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded font-semibold text-xs transition cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                      {isStopping ? 'Stopping...' : 'Stop Pod'}
                    </button>
                  </div>
                </div>

                {/* Live resource bars */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-gray-50 border border-gray-200 rounded-lg p-4">

                  {/* VRAM */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">VRAM</span>
                      <span className="text-[10px] font-mono font-bold text-orange-600">
                        {liveVramMb >= 1024 ? (liveVramMb / 1024).toFixed(2) + ' GB' : Math.round(liveVramMb) + ' MB'}
                        <span className="text-gray-400 font-normal"> / {capVramGb.toFixed(1)} GB</span>
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-orange-100 rounded-full overflow-hidden border border-orange-200">
                      <div
                        style={{ width: vramPct + '%', transition: 'width 0.5s ease' }}
                        className={'h-full rounded-full ' + vramColor}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-orange-500">{vramPct.toFixed(0)}% of cap</span>
                      <span className="text-gray-400">Cap: {capVramGb.toFixed(1)} GB</span>
                    </div>
                  </div>

                  {/* RAM */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">System RAM</span>
                      <span className="text-[10px] font-mono font-bold text-blue-600">
                        {liveRamGb.toFixed(2)} GB
                        <span className="text-gray-400 font-normal"> / {capRamGb.toFixed(1)} GB</span>
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-blue-100 rounded-full overflow-hidden border border-blue-200">
                      <div
                        style={{ width: ramPct + '%', transition: 'width 0.5s ease' }}
                        className={'h-full rounded-full ' + ramColor}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-blue-500">{ramPct.toFixed(0)}% of cap</span>
                      <span className="text-gray-400">Cap: {capRamGb.toFixed(1)} GB</span>
                    </div>
                  </div>

                  {/* CPU */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">CPU Cores</span>
                      <span className="text-[10px] font-mono font-bold text-green-600">
                        {liveCpuCores.toFixed(2)} Cores
                        <span className="text-gray-400 font-normal"> / {capCpuCores}</span>
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-green-100 rounded-full overflow-hidden border border-green-200">
                      <div
                        style={{ width: cpuPct + '%', transition: 'width 0.5s ease' }}
                        className={'h-full rounded-full ' + cpuColor}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="text-green-500">{cpuPct.toFixed(0)}% of cap</span>
                      <span className="text-gray-400">Cap: {capCpuCores} Cores</span>
                    </div>
                  </div>
                </div>

                {/* Tunnel row */}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] font-mono text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span className="text-gray-700 font-medium">Cloudflare WireGuard Quick Tunnel</span>
                  </div>
                  <span className="text-gray-400">Port 8888 · Token Authenticated</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
