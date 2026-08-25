import React, { useState, useEffect, useRef } from 'react'

export default function WorkloadLogsPanel({ agentLogs = [], activeContainers = [], clusterJobs = [] }) {
  const [selectedContainer, setSelectedContainer] = useState('all')
  const [containerLogsData, setContainerLogsData] = useState({ containers: [], logs: {} })
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const [isLive, setIsLive] = useState(true)
  const logEndRef = useRef(null)

  // Poll live container logs from agent
  useEffect(() => {
    let active = true
    const fetchContainerLogs = async () => {
      try {
        const res = await fetch('/agent-api/container-logs').catch(() => fetch('http://localhost:9000/container-logs'))
        if (res && res.ok) {
          const data = await res.json()
          if (active) {
            setContainerLogsData(data)
            setIsLive(true)
          }
        }
      } catch {
        if (active) setIsLive(false)
      }
    }

    fetchContainerLogs()
    const interval = setInterval(fetchContainerLogs, 1500)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [containerLogsData, agentLogs, autoScroll, selectedContainer])

  // Assemble logs based on selected container
  const rawLogs = []
  if (selectedContainer === 'all') {
    // Combine agent startup events with container logs
    const cLogs = Object.entries(containerLogsData.logs || {}).flatMap(([cName, lines]) =>
      lines.map((l) => `[${cName}] ${l}`)
    )
    rawLogs.push(...agentLogs.filter((l) => !l.includes('GET /health')))
    rawLogs.push(...cLogs)
  } else {
    const specificLogs = containerLogsData.logs?.[selectedContainer] || []
    rawLogs.push(...specificLogs)
  }

  // Fallback demo log if container just initialized
  const displayLogs = rawLogs.length > 0 ? rawLogs : [
    `[System] Worker daemon connected. Ready for workload execution.`,
    ...(activeContainers.map(c => `[Docker] Container ${c} active. Streaming stdout/stderr from kernel...`))
  ]

  const handleCopy = () => {
    navigator.clipboard.writeText(displayLogs.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const containerList = containerLogsData.containers.length > 0 
    ? containerLogsData.containers.map(c => c.name)
    : activeContainers

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xs">
      {/* Top Header */}
      <div className="px-6 py-3.5 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          <span className="font-semibold text-xs uppercase tracking-wider text-gray-700">
            Live Docker & Kernel Execution Logs
          </span>
          <span className="px-2 py-0.5 bg-orange-100 text-orange-800 font-mono text-[10px] font-bold rounded">
            {containerList.length} Active {containerList.length === 1 ? 'Pod' : 'Pods'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {/* Auto-scroll toggle */}
          <label className="flex items-center gap-1.5 text-gray-600 text-[11px] font-mono cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 h-3.5 w-3.5 cursor-pointer"
            />
            <span>Auto-Scroll</span>
          </label>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="px-2.5 py-1 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 text-[11px] font-semibold rounded shadow-2xs transition cursor-pointer"
          >
            {copied ? 'Copied' : 'Copy Logs'}
          </button>
        </div>
      </div>

      {/* Container Selector Tabs */}
      <div className="px-6 py-2 bg-gray-100/70 border-b border-gray-200 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mr-1">Source:</span>
        <button
          onClick={() => setSelectedContainer('all')}
          className={`px-3 py-1 text-xs font-mono rounded font-semibold transition cursor-pointer ${
            selectedContainer === 'all'
              ? 'bg-gray-900 text-white shadow-xs'
              : 'bg-white text-gray-700 hover:bg-gray-200 border border-gray-300'
          }`}
        >
          All Stream Output
        </button>

        {containerList.map((cName) => (
          <button
            key={cName}
            onClick={() => setSelectedContainer(cName)}
            className={`px-3 py-1 text-xs font-mono rounded font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              selectedContainer === cName
                ? 'bg-orange-600 text-white shadow-xs'
                : 'bg-white text-gray-700 hover:bg-gray-200 border border-gray-300'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span>{cName}</span>
          </button>
        ))}
      </div>

      {/* Terminal View */}
      <div className="bg-gray-950 text-gray-100 font-mono text-[11px] p-4 h-64 overflow-y-auto leading-relaxed border-t border-gray-800 space-y-0.5">
        {displayLogs.map((line, idx) => {
          const lower = line.toLowerCase()
          const isError = lower.includes('error') || lower.includes('err') || lower.includes('traceback')
          const isPyTorch = lower.includes('torch') || lower.includes('cuda') || lower.includes('gpu memory') || lower.includes('matmul')
          const isReady = lower.includes('running at') || lower.includes('ready') || lower.includes('kernel started')
          const isServer = lower.includes('serverapp') || lower.includes('jupyter')

          let textColor = 'text-gray-300'
          if (isError) textColor = 'text-red-400 font-semibold'
          else if (isPyTorch) textColor = 'text-green-400 font-semibold'
          else if (isReady) textColor = 'text-yellow-300 font-semibold'
          else if (isServer) textColor = 'text-blue-300'

          return (
            <div key={idx} className={`whitespace-pre-wrap break-all hover:bg-gray-800/50 px-1 py-0.5 rounded ${textColor}`}>
              {line}
            </div>
          )
        })}
        <div ref={logEndRef} />
      </div>

      {/* Bottom Info Bar */}
      <div className="px-6 py-2 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-between text-[11px] font-mono text-gray-500">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span>Real-time standard output from Docker Engine daemon</span>
        </div>
        <span>Showing last 80 lines per container</span>
      </div>
    </div>
  )
}
