import React from 'react'

export default function NodeMeshInfo({ machineId, tailscaleIp, providerConfig, agentOnline }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
        <div>
          <h3 className="font-bold text-sm text-gray-900">Mesh Network & Node Identity</h3>
          <p className="text-xs text-gray-500 mt-0.5">Secure peer-to-peer connection parameters</p>
        </div>
        <span className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded border border-gray-200">
          Tailscale WireGuard
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="bg-gray-50 p-3 rounded border border-gray-200">
          <span className="text-gray-500 text-[10px] uppercase font-semibold block">Registered Node ID</span>
          <span className="font-mono font-bold text-gray-900 mt-0.5 block break-all">{machineId || 'node-local'}</span>
        </div>

        <div className="bg-gray-50 p-3 rounded border border-gray-200">
          <span className="text-gray-500 text-[10px] uppercase font-semibold block">Private Mesh IPv4</span>
          <span className="font-mono font-bold text-gray-900 mt-0.5 block">{tailscaleIp || '127.0.0.1'}</span>
        </div>

        <div className="bg-gray-50 p-3 rounded border border-gray-200">
          <span className="text-gray-500 text-[10px] uppercase font-semibold block">Heartbeat Frequency</span>
          <span className="font-mono font-bold text-gray-900 mt-0.5 block">Every 3 Seconds</span>
        </div>

        <div className="bg-gray-50 p-3 rounded border border-gray-200">
          <span className="text-gray-500 text-[10px] uppercase font-semibold block">Isolation Runtime</span>
          <span className="font-mono font-bold text-gray-900 mt-0.5 block">Docker + Cgroups</span>
        </div>
      </div>
    </div>
  )
}
