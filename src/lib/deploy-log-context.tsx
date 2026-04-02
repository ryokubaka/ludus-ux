"use client"

import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react"

interface DeployLogContextValue {
  lines: string[]
  isStreaming: boolean
  rangeState: string | null
  /** The rangeId currently being streamed (null when idle). */
  activeRangeId: string | null
  startStreaming: (rangeId?: string) => void
  stopStreaming: () => void
  clearLogs: () => void
}

const DeployLogContext = createContext<DeployLogContextValue | null>(null)

export function DeployLogProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [rangeState, setRangeState] = useState<string | null>(null)
  const [activeRangeId, setActiveRangeId] = useState<string | null>(null)

  const esRef = useRef<EventSource | null>(null)
  const isStreamingRef = useRef(false)
  const targetRangeRef = useRef<string | undefined>(undefined)

  const stopStreaming = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    isStreamingRef.current = false
    setIsStreaming(false)
  }, [])

  const startStreaming = useCallback((rangeId?: string) => {
    // Close any previous connection first
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    targetRangeRef.current = rangeId
    isStreamingRef.current = true
    setActiveRangeId(rangeId ?? null)
    setIsStreaming(true)
    setRangeState(null)

    // Build the URL for the server-side SSE stream.  The server polls the Ludus
    // API internally every 2 s and pushes incremental log lines + state changes —
    // no client-side polling needed at all.
    const url = new URL("/api/logs/stream", window.location.origin)
    if (rangeId) url.searchParams.set("rangeId", rangeId)

    const es = new EventSource(url.toString())
    esRef.current = es

    es.onmessage = (event) => {
      const raw: string = event.data

      if (raw.startsWith("[STATE] ")) {
        // Intermediate state update — update UI badge without stopping the stream
        setRangeState(raw.slice(8).trim())
      } else if (raw.startsWith("[DONE] ")) {
        // Server signals deploy finished (SUCCESS / ERROR / ABORTED / etc.)
        setRangeState(raw.slice(7).trim())
        stopStreaming()
      } else if (raw.startsWith("[ERROR] ")) {
        // Server-side error — surface it as a log line and stop
        setLines((prev) => [...prev, raw])
        stopStreaming()
      } else if (raw.startsWith("[LUDUS] ")) {
        setLines((prev) => [...prev, raw.slice(8)])
      } else if (raw.startsWith("[GOAD] ")) {
        setLines((prev) => [...prev, raw.slice(7)])
      }
      // Unknown prefix: silently ignore to stay forward-compatible
    }

    es.onerror = () => {
      // The server closed the connection (stream finished) or a network error
      // occurred.  Either way, mark streaming as done so the UI can react.
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      isStreamingRef.current = false
      setIsStreaming(false)
    }
  }, [stopStreaming])

  const clearLogs = useCallback(() => {
    setLines([])
    setRangeState(null)
    setActiveRangeId(null)
  }, [])

  // Clean up on provider unmount
  useEffect(() => () => stopStreaming(), [stopStreaming])

  return (
    <DeployLogContext.Provider
      value={{ lines, isStreaming, rangeState, activeRangeId, startStreaming, stopStreaming, clearLogs }}
    >
      {children}
    </DeployLogContext.Provider>
  )
}

export function useDeployLogContext() {
  const ctx = useContext(DeployLogContext)
  if (!ctx) throw new Error("useDeployLogContext must be used within DeployLogProvider")
  return ctx
}
