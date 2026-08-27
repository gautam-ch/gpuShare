const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('providerAPI', {
  getHardwareTelemetry: () => ipcRenderer.invoke('get-hardware-telemetry'),
  getAgentStatus: () => ipcRenderer.invoke('get-agent-status'),
  getClusterStatus: (machineId) => ipcRenderer.invoke('get-cluster-status', machineId),
  getProviderConfig: () => ipcRenderer.invoke('get-provider-config'),
  saveProviderConfig: (config) => ipcRenderer.invoke('save-provider-config', config),
  runAutomatedPipeline: (config) => ipcRenderer.invoke('run-automated-pipeline', config),
  runFullMlSetup: (config) => ipcRenderer.invoke('run-full-ml-setup', config),
  startElevatedSetup: () => ipcRenderer.invoke('start-elevated-setup'),
  startAgentService: (config) => ipcRenderer.invoke('start-agent-service', config),
  stopAgentService: () => ipcRenderer.invoke('stop-agent-service'),
  onPipelineStep: (callback) => {
    const handler = (event, data) => callback(data)
    ipcRenderer.on('pipeline-step', handler)
    return () => ipcRenderer.removeListener('pipeline-step', handler)
  },
  onPipelineLog: (callback) => {
    const handler = (event, text) => callback(text)
    ipcRenderer.on('pipeline-log', handler)
    return () => ipcRenderer.removeListener('pipeline-log', handler)
  },
  onAgentLog: (callback) => {
    const handler = (event, text) => callback(text)
    ipcRenderer.on('agent-log', handler)
    return () => ipcRenderer.removeListener('agent-log', handler)
  }
})
