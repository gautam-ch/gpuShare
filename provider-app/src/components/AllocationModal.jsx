import React, { useState } from 'react'

export default function AllocationModal({
  isOpen,
  onClose,
  currentConfig,
  physicalHardware,
  onSaveConfig
}) {
  const totalPhysicalVram = Math.round(((physicalHardware.gpu?.total_vram_mb || 8192) / 1024) * 10) / 10
  const totalPhysicalCpus = physicalHardware.cpu?.cores || 8
  const totalPhysicalRam = Math.round((physicalHardware.ram?.totalGb || 16.0) * 10) / 10

  const [vram, setVram] = useState(
    currentConfig?.shared_vram_gb || Math.min(4.0, totalPhysicalVram)
  )
  const [cpus, setCpus] = useState(
    currentConfig?.shared_cpus || Math.max(1, totalPhysicalCpus - 2)
  )
  const [ram, setRam] = useState(
    currentConfig?.shared_ram_gb || Math.min(8.0, Math.round(totalPhysicalRam * 0.5))
  )
  const [saving, setSaving] = useState(false)

  if (!isOpen) return null

  const handleSave = async () => {
    setSaving(true)
    const newConfig = {
      shared_vram_gb: Number(vram),
      shared_cpus: Number(cpus),
      shared_ram_gb: Number(ram)
    }
    await onSaveConfig(newConfig)
    setSaving(false)
    onClose()
  }

  const privateVram = Math.max(0, Math.round((totalPhysicalVram - vram) * 10) / 10)
  const privateCpus = Math.max(0, totalPhysicalCpus - cpus)
  const privateRam = Math.max(0, Math.round((totalPhysicalRam - ram) * 10) / 10)

  const vramOptions = [0.5, 1, 2, 4, 6, 8, 12, 16, 24].filter(v => v <= totalPhysicalVram)
  if (!vramOptions.includes(totalPhysicalVram) && totalPhysicalVram > 0) {
    vramOptions.push(totalPhysicalVram)
  }

  const cpuOptions = [1, 2, 4, 6, 8, 12, 16, 32].filter(c => c <= totalPhysicalCpus)
  if (!cpuOptions.includes(totalPhysicalCpus)) {
    cpuOptions.push(totalPhysicalCpus)
  }

  const ramOptions = [2, 4, 8, 12, 16, 24, 32, 64].filter(r => r <= totalPhysicalRam)
  if (!ramOptions.includes(totalPhysicalRam) && totalPhysicalRam > 0) {
    ramOptions.push(totalPhysicalRam)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-gray-300 rounded-lg max-w-2xl w-full shadow-lg overflow-hidden animate-in fade-in duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded bg-orange-100 border border-orange-200 text-orange-800 text-[10px] font-bold uppercase tracking-wider mb-1">
              Provider Sharing Controls
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-tight">
              Select Hardware Sharing Limits
            </h2>
          </div>
          {currentConfig && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-sm font-bold px-2 py-1 rounded cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          <p className="text-xs text-gray-600 leading-relaxed">
            Select the exact amount of hardware capacity you wish to allocate to renters. Once selected, your node automatically verifies Docker and network prerequisites and launches your provider daemon.
          </p>

          {/* 1. GPU VRAM Allocation */}
          <div className="space-y-3 p-4 bg-gray-50 border border-gray-200 rounded-md">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-800 block">
                  1. Dedicated GPU VRAM to Share
                </span>
                <span className="text-[11px] text-gray-500">
                  Total Physical: {totalPhysicalVram} GB ({physicalHardware.gpu?.model || 'GPU'})
                </span>
              </div>
              <div className="px-3 py-1 bg-white border border-orange-300 rounded font-mono font-bold text-orange-700 text-sm shadow-xs">
                {vram} GB Shared
              </div>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 pt-1">
              {vramOptions.map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setVram(val)}
                  className={`py-2 text-xs font-mono font-bold rounded border transition-colors cursor-pointer ${
                    vram === val
                      ? 'bg-[#F37626] text-white border-[#F37626] shadow-xs'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {val} GB
                </button>
              ))}
            </div>

            <div className="flex justify-between text-[11px] font-mono text-gray-600 pt-1 border-t border-gray-200">
              <span className="text-orange-700 font-semibold">Shared with network: {vram} GB</span>
              <span className="text-gray-500">Private for host: {privateVram} GB</span>
            </div>
          </div>

          {/* 2. CPU Cores Allocation */}
          <div className="space-y-3 p-4 bg-gray-50 border border-gray-200 rounded-md">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-800 block">
                  2. CPU Cores to Share
                </span>
                <span className="text-[11px] text-gray-500">
                  Total Physical: {totalPhysicalCpus} Cores ({physicalHardware.cpu?.brand || 'CPU'})
                </span>
              </div>
              <div className="px-3 py-1 bg-white border border-gray-300 rounded font-mono font-bold text-gray-900 text-sm shadow-xs">
                {cpus} {cpus === 1 ? 'Core' : 'Cores'} Shared
              </div>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 pt-1">
              {cpuOptions.map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setCpus(val)}
                  className={`py-2 text-xs font-mono font-bold rounded border transition-colors cursor-pointer ${
                    cpus === val
                      ? 'bg-gray-900 text-white border-gray-900 shadow-xs'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {val} {val === 1 ? 'Core' : 'Cores'}
                </button>
              ))}
            </div>

            <div className="flex justify-between text-[11px] font-mono text-gray-600 pt-1 border-t border-gray-200">
              <span className="text-gray-900 font-semibold">Shared with network: {cpus} Cores</span>
              <span className="text-gray-500">Private for host: {privateCpus} Cores</span>
            </div>
          </div>

          {/* 3. System RAM Allocation */}
          <div className="space-y-3 p-4 bg-gray-50 border border-gray-200 rounded-md">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-800 block">
                  3. System Memory (RAM) to Share
                </span>
                <span className="text-[11px] text-gray-500">
                  Total Physical: {totalPhysicalRam} GB RAM
                </span>
              </div>
              <div className="px-3 py-1 bg-white border border-gray-300 rounded font-mono font-bold text-gray-900 text-sm shadow-xs">
                {ram} GB Shared
              </div>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 pt-1">
              {ramOptions.map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setRam(val)}
                  className={`py-2 text-xs font-mono font-bold rounded border transition-colors cursor-pointer ${
                    ram === val
                      ? 'bg-gray-900 text-white border-gray-900 shadow-xs'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {val} GB
                </button>
              ))}
            </div>

            <div className="flex justify-between text-[11px] font-mono text-gray-600 pt-1 border-t border-gray-200">
              <span className="text-gray-900 font-semibold">Shared with network: {ram} GB</span>
              <span className="text-gray-500">Private for host: {privateRam} GB</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-4">
          <div className="text-xs text-gray-500 font-mono">
            Limits auto-enforced via Docker cgroups
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 bg-[#F37626] hover:bg-[#d95f0e] text-white font-semibold text-xs rounded shadow-xs transition disabled:opacity-50 cursor-pointer flex items-center gap-2"
          >
            {saving ? 'Saving...' : 'Lock Limits & Launch Node'}
          </button>
        </div>
      </div>
    </div>
  )
}
