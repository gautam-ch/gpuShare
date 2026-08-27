import React from 'react'

export default function Header({
  agentOnline,
  clusterConnected,
  machineId,
  tailscaleIp,
  lastUpdated,
  onOpenSetupModal
}) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30 shadow-xs">
      <div className="flex items-center gap-3">
        <svg className="w-7 h-7" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="22" cy="7" r="4" fill="#616161" />
          <path d="M7.5 22C7.5 13.9919 13.9919 7.5 22 7.5C22.68 7.5 23.3448 7.54707 23.9942 7.63821C16.9209 8.63185 11.5 14.6806 11.5 22C11.5 29.3194 16.9209 35.3681 23.9942 36.3618C23.3448 36.4529 22.68 36.5 22 36.5C13.9919 36.5 7.5 30.0081 7.5 22Z" fill="#F37626" />
          <circle cx="22" cy="37" r="4" fill="#616161" />
          <circle cx="34" cy="14" r="3.5" fill="#616161" />
          <circle cx="10" cy="30" r="3" fill="#616161" />
        </svg>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-gray-900 tracking-tight leading-tight">
              Kinetic <span className="text-xs font-semibold px-2 py-0.5 bg-orange-100 text-orange-800 rounded border border-orange-200">Provider Node</span>
            </h1>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">Real-time GPU compute & workload monitoring</p>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs font-mono">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded">
          <span className="text-gray-500 font-sans uppercase text-[10px] font-semibold">Node ID:</span>
          <span className="text-gray-900 font-bold">{machineId || 'detecting...'}</span>
        </div>

        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded">
          <span className="text-gray-500 font-sans uppercase text-[10px] font-semibold">Mesh IP:</span>
          <span className="text-gray-900 font-bold">{tailscaleIp || '127.0.0.1'}</span>
        </div>

        <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded font-sans font-medium">
          <span className={`w-2 h-2 rounded-full ${agentOnline ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
          <span className={agentOnline ? 'text-green-800' : 'text-amber-800'}>
            {agentOnline ? 'Agent Active' : 'Agent Standby'}
          </span>
        </div>

        <button
          onClick={onOpenSetupModal}
          className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 font-sans font-semibold rounded shadow-xs transition cursor-pointer flex items-center gap-1.5"
        >
          <span>Node Initializer / Auto-Setup</span>
        </button>
      </div>
    </header>
  )
}
