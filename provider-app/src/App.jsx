import React, { useState, useEffect, useCallback } from 'react'
import Header from './components/Header.jsx'
import GpuUsageCard from './components/GpuUsageCard.jsx'
import CpuRamUsageCard from './components/CpuRamUsageCard.jsx'
import ActiveJobsTable from './components/ActiveJobsTable.jsx'
import WorkloadLogsPanel from './components/WorkloadLogsPanel.jsx'
import NodeMeshInfo from './components/NodeMeshInfo.jsx'
import AllocationModal from './components/AllocationModal.jsx'
import AutomatedPipelineModal from './components/AutomatedPipelineModal.jsx'
import SetupRunnerModal from './components/SetupRunnerModal.jsx'

export default function App() {
  const [telemetry, setTelemetry] = useState({
    cpu: { cores: 8, physicalCores: 8, brand: 'Intel Core i7 / AMD Ryzen', loadPct: 18 },
    ram: { totalGb: 16.0, usedGb: 6.4, freeGb: 9.6, usedPct: 40 },
    gpu: {
      model: 'NVIDIA Graphics Processor',
      total_vram_mb: 8192,
      used_vram_mb: 0,
      free_vram_mb: 8192,
      gpu_util_pct: 0,
      temp_c: 48,
      has_nvidia: true
    }
  })

  // Provider configuration (stored in host_config.json & localStorage)
  const [providerConfig, setProviderConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('gpushare_provider_config')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false)
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false)
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false)
  const [agentLogs, setAgentLogs] = useState([])

  const [agentStatus, setAgentStatus] = useState({
    online: true,
    data: {
      machine_id: 'node-local',
      provider_config: null,
      active_containers: [],
      active_jobs: 0
    }
  })

  const [clusterInfo, setClusterInfo] = useState({
    connected: true,
    machine: null,
    activeJobs: []
  })

  const [lastUpdated, setLastUpdated] = useState(new Date())

  // Listen for agent stdout/stderr logs from Electron
  useEffect(() => {
    if (window.providerAPI?.onAgentLog) {
      const unsub = window.providerAPI.onAgentLog((text) => {
        const timestamp = new Date().toLocaleTimeString()
        const lines = text.split('\n').filter(l => l.trim().length > 0)
        setAgentLogs(prev => [...prev.slice(-300), ...lines.map(l => `[${timestamp}] ${l}`)])
      })
      return () => unsub()
    }
  }, [])

  // Initial config load from Electron IPC
  useEffect(() => {
    const loadInitialConfig = async () => {
      if (window.providerAPI?.getProviderConfig) {
        const cfg = await window.providerAPI.getProviderConfig()
        if (cfg) {
          setProviderConfig(cfg)
          localStorage.setItem('gpushare_provider_config', JSON.stringify(cfg))
        } else if (!providerConfig) {
          setIsConfigModalOpen(true)
        }
      } else if (!providerConfig) {
        setIsConfigModalOpen(true)
      }
    }
    loadInitialConfig()
  }, [])

  // Save handler
  const handleSaveConfig = async (newConfig) => {
    setProviderConfig(newConfig)
    try {
      localStorage.setItem('gpushare_provider_config', JSON.stringify(newConfig))
    } catch { }

    if (window.providerAPI?.saveProviderConfig) {
      await window.providerAPI.saveProviderConfig(newConfig)
    }

    setIsPipelineModalOpen(true)
  }

  const handleStartAgent = async (cfg) => {
    if (window.providerAPI?.startAgentService) {
      await window.providerAPI.startAgentService(cfg || providerConfig)
      setTimeout(fetchAllData, 1000)
    }
  }

  const handleStopAgent = async () => {
    if (window.providerAPI?.stopAgentService) {
      await window.providerAPI.stopAgentService()
      setTimeout(fetchAllData, 1000)
    }
  }

  const [activeContainersList, setActiveContainersList] = useState([])

  // Polling loop
  const fetchAllData = useCallback(async () => {
    try {
      let currentMachineId = agentStatus?.data?.machine_id || 'node-local'

      // 1. Direct Agent Telemetry & Logs (Port 9000 / Proxy)
      try {
        const [healthRes, logsRes] = await Promise.all([
          fetch('/agent-api/health').catch(() => fetch('http://localhost:9000/health')).catch(() => null),
          fetch('/agent-api/container-logs').catch(() => fetch('http://localhost:9000/container-logs')).catch(() => null)
        ])

        let foundContainers = []

        if (healthRes && healthRes.ok) {
          const data = await healthRes.json()
          setAgentStatus({ online: true, data })
          if (data.machine_id) currentMachineId = data.machine_id
          if (data.gpu) {
            setTelemetry(prev => ({ ...prev, gpu: data.gpu }))
          }
          if (data.cpu) {
            setTelemetry(prev => ({ ...prev, cpu: data.cpu }))
          }
          if (data.ram) {
            setTelemetry(prev => ({ ...prev, ram: data.ram }))
          }
          if (data.active_containers_telemetry) {
            setTelemetry(prev => ({ ...prev, active_containers_telemetry: data.active_containers_telemetry }))
          }
          if (data.provider_config) {
            setProviderConfig(data.provider_config)
          }
          if (Array.isArray(data.active_containers)) {
            foundContainers.push(...data.active_containers)
          }
        } else if (window.providerAPI?.getAgentStatus) {
          const ag = await window.providerAPI.getAgentStatus()
          if (ag && ag.data) {
            setAgentStatus(ag)
            if (ag.data.machine_id) currentMachineId = ag.data.machine_id
            if (ag.data.gpu) setTelemetry(prev => ({ ...prev, gpu: ag.data.gpu }))
            if (ag.data.cpu) setTelemetry(prev => ({ ...prev, cpu: ag.data.cpu }))
            if (ag.data.ram) setTelemetry(prev => ({ ...prev, ram: ag.data.ram }))
            if (ag.data.active_containers_telemetry) {
              setTelemetry(prev => ({ ...prev, active_containers_telemetry: ag.data.active_containers_telemetry }))
            }
            if (ag.data.provider_config) {
              setProviderConfig(ag.data.provider_config)
            }
            if (Array.isArray(ag.data.active_containers)) {
              foundContainers.push(...ag.data.active_containers)
            }
          }
        }

        if (logsRes && logsRes.ok) {
          const lData = await logsRes.json()
          if (Array.isArray(lData.containers)) {
            foundContainers.push(...lData.containers.map(c => c.name))
          }
        }

        const uniqueContainers = Array.from(new Set(foundContainers.filter(Boolean)))
        setActiveContainersList(uniqueContainers)
      } catch (agentErr) {
        console.warn('Agent telemetry fetch error:', agentErr)
      }

      // 2. Fallback OS hardware telemetry if agent offline
      if (!agentStatus.online && window.providerAPI?.getHardwareTelemetry) {
        const hw = await window.providerAPI.getHardwareTelemetry()
        if (hw && !hw.error) {
          setTelemetry(prev => ({
            ...prev,
            cpu: prev.cpu || hw.cpu,
            ram: prev.ram || hw.ram,
            gpu: prev.gpu || hw.gpu
          }))
        }
      }

      // 3. Central Cluster Node & Job Status
      try {
        if (window.providerAPI?.getClusterStatus) {
          const cl = await window.providerAPI.getClusterStatus(currentMachineId)
          if (cl && cl.connected) {
            setClusterInfo(cl)
          }
        } else {
          const [mRes, jRes] = await Promise.all([
            fetch('/cluster-api/machines').catch(() => null),
            fetch('/cluster-api/admin/jobs').catch(() => null)
          ])
          if (mRes && mRes.ok) {
            const machines = await mRes.json()
            const myNode = machines.find((m) => m.id === currentMachineId) || machines[machines.length - 1]
            let jobs = []
            if (jRes && jRes.ok) {
              try { jobs = await jRes.json() } catch { }
            }
            setClusterInfo({ connected: true, machine: myNode, activeJobs: jobs })
          }
        }
      } catch (clErr) {
        console.warn('Cluster status fetch error:', clErr)
      }

      setLastUpdated(new Date())
    } catch (err) {
      console.error('Telemetry refresh error:', err)
    }
  }, [agentStatus?.data?.machine_id, agentStatus.online, providerConfig])

  useEffect(() => {
    fetchAllData()
    const interval = setInterval(fetchAllData, 2000)
    return () => clearInterval(interval)
  }, [fetchAllData])

  const machineId = agentStatus?.data?.machine_id || clusterInfo?.machine?.id || 'node-host'
  const tailscaleIp = clusterInfo?.machine?.tailscale_ip || '127.0.0.1'

  const activeConfig = providerConfig || agentStatus?.data?.provider_config || {
    shared_vram_gb: Math.min(4.0, (telemetry.gpu?.total_vram_mb || 8192) / 1024),
    shared_cpus: Math.max(1, (telemetry.cpu?.cores || 4) - 2),
    shared_ram_gb: Math.min(8.0, Math.round((telemetry.ram?.totalGb || 16) * 0.5))
  }

  const activeContainers = activeContainersList.length > 0 ? activeContainersList : (agentStatus?.data?.active_containers || [])

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-gray-900 flex flex-col">
      <Header
        agentOnline={agentStatus.online}
        clusterConnected={clusterInfo.connected}
        machineId={machineId}
        tailscaleIp={tailscaleIp}
        lastUpdated={lastUpdated}
        onOpenSetupModal={() => setIsPipelineModalOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Sharing Limits & Node Controller Banner */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-bold tracking-wider text-gray-500">Active Sharing Allocation</span>
              <span className="px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-bold uppercase rounded">
                Cap Enforced
              </span>
            </div>
            <div className="text-sm font-mono font-bold text-gray-900 flex flex-wrap items-center gap-2">
              <span className="text-orange-600">{activeConfig.shared_vram_gb} GB VRAM Max</span>
              <span className="text-gray-400">•</span>
              <span>{activeConfig.shared_cpus} CPU Cores</span>
              <span className="text-gray-400">•</span>
              <span>{activeConfig.shared_ram_gb} GB RAM</span>
            </div>
            <p className="text-[11px] text-gray-500">
              Renters cannot exceed these caps. All other hardware remains private for your local use.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsConfigModalOpen(true)}
              className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded shadow-xs transition cursor-pointer shrink-0"
            >
              Adjust Sharing Limits
            </button>
            <button
              onClick={() => setIsPipelineModalOpen(true)}
              className="px-4 py-2 bg-[#F37626] hover:bg-[#d95f0e] text-white text-xs font-semibold rounded shadow-xs transition cursor-pointer shrink-0"
            >
              Launch Diagnostics
            </button>
          </div>
        </div>

        {/* Overload Alert Warning (if triggered by Watchdog) */}
        {agentStatus?.data?.overload_alerts?.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between text-xs text-red-800">
            <div className="flex items-center gap-2">
              <span className="text-base">🚨</span>
              <div>
                <strong>Hardware Overload Guard Activated:</strong> {agentStatus.data.overload_alerts[agentStatus.data.overload_alerts.length - 1].reason}. Containers were automatically halted and reclaimed to protect your system.
              </div>
            </div>
            <span className="font-mono text-[10px] text-red-600 bg-white px-2 py-0.5 rounded border border-red-200 font-bold shrink-0">
              Host Protected
            </span>
          </div>
        )}

        {/* Hardware Status Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <GpuUsageCard
            gpu={telemetry.gpu}
            providerConfig={activeConfig}
            activeContainers={activeContainers}
            clusterJobs={clusterInfo.activeJobs}
          />
          <CpuRamUsageCard
            cpu={telemetry.cpu}
            ram={telemetry.ram}
            providerConfig={activeConfig}
            activeContainers={activeContainers}
            clusterJobs={clusterInfo.activeJobs}
          />
        </div>

        {/* Workload Pods Table */}
        <ActiveJobsTable
          activeContainers={activeContainers}
          clusterJobs={clusterInfo.activeJobs}
          gpu={telemetry.gpu}
          activeContainersTelemetry={telemetry.active_containers_telemetry || {}}
          onRefresh={fetchAllData}
        />

        {/* Live Workload & Container Execution Logs Panel */}
        <WorkloadLogsPanel
          agentLogs={agentLogs}
          activeContainers={activeContainers}
          clusterJobs={clusterInfo.activeJobs}
        />

        {/* Node Mesh Networking */}
        <NodeMeshInfo
          machineId={machineId}
          tailscaleIp={tailscaleIp}
          providerConfig={activeConfig}
          agentOnline={agentStatus.online}
        />
      </main>

      {/* Allocation Setup Modal */}
      <AllocationModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        currentConfig={providerConfig}
        physicalHardware={telemetry}
        onSaveConfig={handleSaveConfig}
      />

      {/* Automated Pipeline Launcher Modal */}
      <AutomatedPipelineModal
        isOpen={isPipelineModalOpen}
        onClose={() => setIsPipelineModalOpen(false)}
        config={activeConfig}
        onCompleted={(cfg) => {
          setProviderConfig(cfg)
          fetchAllData()
        }}
      />

      {/* Elevated Setup Fallback Modal */}
      <SetupRunnerModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        providerConfig={activeConfig}
        agentOnline={agentStatus.online}
        onStartAgent={handleStartAgent}
        onStopAgent={handleStopAgent}
      />

      <footer className="border-t border-gray-200 bg-white py-4 text-center text-xs text-gray-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <span>
            GPU Share Hub — <strong>Provider Node Agent</strong>
          </span>
          <span className="font-mono text-[11px]">
            Live Workload Telemetry: Active · Kintetic PyData Design
          </span>
        </div>
      </footer>
    </div>
  )
}
