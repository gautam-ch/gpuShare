import React from 'react'

export default function GpuUsageCard({ gpu, providerConfig, activeContainers = [], clusterJobs = [] }) {
  const totalPhysicalVramMb = gpu?.total_vram_mb || 4096
  const sharedVramGb = providerConfig?.shared_vram_gb || (totalPhysicalVramMb / 1024)
  const sharedVramMb = sharedVramGb * 1024

  const activeCount = activeContainers.length

  // Active renter jobs — "done" = Jupyter is live and consuming resources
  const activeJobs = clusterJobs.filter(
    j => j.status === 'done' || j.status === 'assigned' || j.status === 'pending'
  )

  // Client-reserved VRAM: if no containers are running, usage is strictly 0
  const clientVramSum = activeJobs.reduce((sum, j) => sum + (j.vram_required_mb || 0), 0)
  const usedVramMb = activeCount === 0
    ? 0
    : (gpu?.client_used_vram_mb !== undefined
        ? gpu.client_used_vram_mb
        : (clientVramSum > 0 ? Math.min(clientVramSum, sharedVramMb) : activeCount * 512))

  const freeVramMb = Math.max(0, sharedVramMb - usedVramMb)

  // Raw NVML GPU core utilization % (actual hardware activity, not our calc)
  const gpuUtilPct = Math.round(gpu?.gpu_util_pct || 0)
  const isGpuInUse = activeCount > 0 || usedVramMb > 0 || gpuUtilPct > 5

  // Calculate percentage slices relative to total physical VRAM
  const clientPct = Math.min(100, (usedVramMb / totalPhysicalVramMb) * 100)
  const sharedFreePct = Math.min(100 - clientPct, (freeVramMb / totalPhysicalVramMb) * 100)
  const hostPrivatePct = Math.max(0, 100 - clientPct - sharedFreePct)

  // Client consumption % relative to shared cap
  const clientOfSharedPct = sharedVramMb > 0
    ? Math.min(100, (usedVramMb / sharedVramMb) * 100)
    : 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div>
            <div className="text-xs uppercase font-bold tracking-wider text-gray-500 flex items-center gap-2">
              <span>GPU Accelerator</span>
              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-mono">CUDA 12.x</span>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mt-0.5">{gpu?.model || 'NVIDIA GeForce GTX 1650'}</h2>
          </div>
          <div>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold uppercase tracking-wider border ${
                isGpuInUse
                  ? 'bg-orange-50 text-orange-800 border-orange-200'
                  : 'bg-green-50 text-green-800 border-green-200'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isGpuInUse ? 'bg-orange-600 animate-pulse' : 'bg-green-500'}`} />
              {isGpuInUse ? 'In Use (Rented)' : 'Available (Idle)'}
            </span>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-2.5 my-4">
          <div className="bg-gray-50 border border-gray-200 rounded p-2.5 text-center">
            <span className="text-[10px] uppercase font-semibold text-gray-500 block">GPU Core Load</span>
            <span className="text-xl font-bold font-mono text-gray-900 mt-0.5 block">{gpuUtilPct}%</span>
            <span className="text-[9px] text-gray-400 font-mono">Live NVML</span>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded p-2.5 text-center">
            <span className="text-[10px] uppercase font-semibold text-orange-600 block">Client VRAM</span>
            <span className="text-xl font-bold font-mono text-orange-600 mt-0.5 block">
              {usedVramMb >= 1024 ? `${(usedVramMb / 1024).toFixed(1)} GB` : `${Math.round(usedVramMb)} MB`}
            </span>
            <span className="text-[9px] text-orange-400 font-mono">{clientOfSharedPct.toFixed(0)}% of cap</span>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded p-2.5 text-center">
            <span className="text-[10px] uppercase font-semibold text-gray-500 block">Temperature</span>
            <span className="text-xl font-bold font-mono text-gray-900 mt-0.5 block">
              {gpu?.temp_c ? `${Math.round(gpu.temp_c)}°C` : '47°C'}
            </span>
            <span className="text-[9px] text-gray-400 font-mono">GPU Die</span>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded p-2.5 text-center">
            <span className="text-[10px] uppercase font-semibold text-gray-500 block">Active Pods</span>
            <span className="text-xl font-bold font-mono text-orange-600 mt-0.5 block">
              {activeCount}
            </span>
            <span className="text-[9px] text-gray-400 font-mono">Renters</span>
          </div>
        </div>

        {/* VRAM Visual Bar */}
        <div className="space-y-2 mt-4">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-gray-700">VRAM Allocation Breakdown</span>
            <span className="font-mono text-gray-900 font-bold">
              {(usedVramMb / 1024).toFixed(2)} GB client / {sharedVramGb.toFixed(1)} GB shared cap
            </span>
          </div>

          <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden flex border border-gray-200">
            {/* Client-reserved VRAM */}
            <div
              style={{ width: `${clientPct}%` }}
              className="bg-[#F37626] h-full transition-all duration-300 relative group"
              title={`Client Reserved VRAM: ${(usedVramMb / 1024).toFixed(2)} GB`}
            />
            {/* Shareable Available (within shared cap) */}
            <div
              style={{ width: `${sharedFreePct}%` }}
              className="bg-green-500 h-full transition-all duration-300"
              title={`Free in Shared Pool: ${(freeVramMb / 1024).toFixed(2)} GB`}
            />
            {/* Provider private (not shared) */}
            <div
              style={{ width: `${hostPrivatePct}%` }}
              className="bg-gray-300 h-full transition-all duration-300"
              title={`Your Private VRAM: ${((totalPhysicalVramMb - sharedVramMb) / 1024).toFixed(1)} GB`}
            />
          </div>

          {/* Bar Legend */}
          <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#F37626]" />
              <span>Client Reserved: {(usedVramMb / 1024).toFixed(2)} GB</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-500" />
              <span>Available: {(freeVramMb / 1024).toFixed(2)} GB</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-gray-300" />
              <span>Your Private: {Math.max(0, (totalPhysicalVramMb - sharedVramMb) / 1024).toFixed(1)} GB</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600 font-mono">
        <span>Hardware VRAM: <strong>{((gpu?.used_vram_mb || 0) / 1024).toFixed(2)} / {(totalPhysicalVramMb / 1024).toFixed(1)} GB</strong> Physical (NVML)</span>
        <span className="text-orange-700 font-semibold">Shared Cap: {sharedVramGb.toFixed(1)} GB</span>
      </div>
    </div>
  )
}
