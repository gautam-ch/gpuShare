import React from 'react'

export default function CpuRamUsageCard({ cpu, ram, providerConfig, clusterJobs = [] }) {
  const totalPhysicalCpus = cpu?.cores || 4
  const sharedCpus = providerConfig?.shared_cpus || 0

  const totalPhysicalRamGb = ram?.totalGb || 16.0
  const sharedRamGb = providerConfig?.shared_ram_gb || 0

  // Active jobs = renter sessions that are running (status "done" means Jupyter is live)
  const activeJobs = clusterJobs.filter(
    j => j.status === 'done' || j.status === 'assigned' || j.status === 'pending'
  )

  // Sum up what the client(s) have reserved from this provider
  const clientCpuCores = activeJobs.reduce((sum, j) => sum + (j.cpu_cores || 0), 0)
  const clientRamGb = activeJobs.reduce((sum, j) => sum + (j.ram_gb || 0), 0)

  // Percentages relative to what was shared (not total physical)
  const clientCpuPct = sharedCpus > 0 ? Math.min(100, (clientCpuCores / sharedCpus) * 100) : 0
  const clientRamPct = sharedRamGb > 0 ? Math.min(100, (clientRamGb / sharedRamGb) * 100) : 0

  // Allocated cap % of physical
  const allocatedCpuPct = totalPhysicalCpus > 0 ? Math.min(100, (sharedCpus / totalPhysicalCpus) * 100) : 0
  const allocatedRamPct = totalPhysicalRamGb > 0 ? Math.min(100, (sharedRamGb / totalPhysicalRamGb) * 100) : 0

  const hasActiveRenters = activeJobs.length > 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div>
            <div className="text-xs uppercase font-bold tracking-wider text-gray-500">Host Compute &amp; Memory</div>
            <h2 className="text-lg font-bold text-gray-900 mt-0.5">CPU &amp; System RAM</h2>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs font-mono text-gray-500">{cpu?.brand || 'Multi-Core Processor'}</span>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                hasActiveRenters
                  ? 'bg-orange-50 text-orange-700 border-orange-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${hasActiveRenters ? 'bg-orange-500 animate-pulse' : 'bg-gray-400'}`} />
              {hasActiveRenters ? `${activeJobs.length} Active Renter${activeJobs.length > 1 ? 's' : ''}` : 'No Active Renters'}
            </span>
          </div>
        </div>

        {/* ── CPU Section ── */}
        <div className="mt-4 space-y-3">
          <div className="text-[11px] uppercase font-bold tracking-wider text-gray-400">CPU Cores</div>

          {/* Allocated Cap Bar */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-gray-700">Your Sharing Allocation</span>
              <span className="font-mono font-bold text-gray-900">
                {sharedCpus} / {totalPhysicalCpus} Cores ({allocatedCpuPct.toFixed(0)}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
              <div
                style={{ width: `${allocatedCpuPct}%` }}
                className="h-full bg-gray-700 transition-all duration-300 rounded-full"
              />
            </div>
            <div className="text-[11px] text-gray-400 font-mono">
              {totalPhysicalCpus - sharedCpus} cores kept private for your use
            </div>
          </div>

          {/* Client Active Usage Bar */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-gray-700">Client Consuming</span>
              <span className={`font-mono font-bold ${hasActiveRenters ? 'text-orange-600' : 'text-gray-400'}`}>
                {clientCpuCores} Cores ({clientCpuPct.toFixed(0)}% of shared)
              </span>
            </div>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200 relative">
              {/* Allocation cap marker */}
              {sharedCpus > 0 && (
                <div
                  style={{ left: `${allocatedCpuPct}%` }}
                  className="absolute top-0 bottom-0 w-px bg-gray-400 z-10"
                />
              )}
              <div
                style={{ width: `${(clientCpuCores / totalPhysicalCpus) * 100}%` }}
                className={`h-full transition-all duration-500 rounded-full ${
                  clientCpuPct > 85 ? 'bg-red-500' : clientCpuPct > 60 ? 'bg-orange-500' : 'bg-[#F37626]'
                }`}
              />
            </div>
            <div className="flex justify-between text-[11px] text-gray-400 font-mono">
              <span>{hasActiveRenters ? `${sharedCpus - clientCpuCores} cores available in shared pool` : 'All shared cores available'}</span>
              <span>Cap: {sharedCpus} Cores</span>
            </div>
          </div>
        </div>

        {/* ── RAM Section ── */}
        <div className="mt-5 space-y-3">
          <div className="text-[11px] uppercase font-bold tracking-wider text-gray-400">System RAM</div>

          {/* Allocated Cap Bar */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-gray-700">Your Sharing Allocation</span>
              <span className="font-mono font-bold text-gray-900">
                {sharedRamGb.toFixed(1)} / {totalPhysicalRamGb.toFixed(1)} GB ({allocatedRamPct.toFixed(0)}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
              <div
                style={{ width: `${allocatedRamPct}%` }}
                className="h-full bg-blue-700 transition-all duration-300 rounded-full"
              />
            </div>
            <div className="text-[11px] text-gray-400 font-mono">
              {(totalPhysicalRamGb - sharedRamGb).toFixed(1)} GB kept private for your use
            </div>
          </div>

          {/* Client Active Usage Bar */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-gray-700">Client Consuming</span>
              <span className={`font-mono font-bold ${hasActiveRenters ? 'text-blue-600' : 'text-gray-400'}`}>
                {clientRamGb.toFixed(1)} GB ({clientRamPct.toFixed(0)}% of shared)
              </span>
            </div>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200 relative">
              {/* Allocation cap marker */}
              {sharedRamGb > 0 && (
                <div
                  style={{ left: `${allocatedRamPct}%` }}
                  className="absolute top-0 bottom-0 w-px bg-gray-400 z-10"
                />
              )}
              <div
                style={{ width: `${(clientRamGb / totalPhysicalRamGb) * 100}%` }}
                className={`h-full transition-all duration-500 rounded-full ${
                  clientRamPct > 85 ? 'bg-red-500' : clientRamPct > 65 ? 'bg-blue-500' : 'bg-blue-500'
                }`}
              />
            </div>
            <div className="flex justify-between text-[11px] text-gray-400 font-mono">
              <span>{hasActiveRenters ? `${(sharedRamGb - clientRamGb).toFixed(1)} GB available in shared pool` : 'All shared RAM available'}</span>
              <span>Cap: {sharedRamGb.toFixed(1)} GB</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 font-mono">
        <span>Physical: {totalPhysicalCpus} Cores · {totalPhysicalRamGb.toFixed(0)} GB RAM</span>
        <span className="text-gray-600">Docker cgroups v2 Enforced</span>
      </div>
    </div>
  )
}
