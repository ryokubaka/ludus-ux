"use client"

import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react"

export type StartRangeStreamOptions = {
  /**
   * When true (default for a new stream with rangeId), the server skips log lines
   * that already exist at connection time — only NEW output appears (good for a
   * fresh deploy). When false, the full current Ludus log buffer is emitted first
   * (needed after refresh / navigation so the panel is not blank until the next line).
   */
  snapshotStart?: boolean
}

interface DeployLogContextValue {
  lines: string[]
  isStreaming: boolean
  rangeState: string | null
  /** The rangeId currently being streamed (null when idle). */
  activeRangeId: string | null
  startStreaming: (rangeId?: string, opts?: StartRangeStreamOptions) => void
  stopStreaming: () => void
  clearLogs: () => void
  /**
   * Re-read rangeState from PocketBase (GET /api/range/pb-status) so the Deploy
   * Status badge updates immediately after abort / external state changes — the
   * SSE stream alone does not push a new [STATE] after the connection closed.
   */
  refreshRangeStateFromServer: (rangeId: string) => Promise<void>
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

  const startStreaming = useCallback((rangeId?: string, opts?: StartRangeStreamOptions) => {
    // Close any previous connection first
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    const snapshotStart = opts?.snapshotStart ?? Boolean(rangeId)

    targetRangeRef.current = rangeId
    isStreamingRef.current = true
    setActiveRangeId(rangeId ?? null)
    setIsStreaming(true)
    setRangeState(null)
    setLines([])

    // Build the URL for the server-side SSE stream.  The server polls the Ludus
    // API internally every 2 s and pushes incremental log lines + state changes —
    // no client-side polling needed at all.
    const url = new URL("/api/logs/stream", window.location.origin)
    if (rangeId) {
      url.searchParams.set("rangeId", rangeId)
      // snapshotStart: see StartRangeStreamOptions — default true for a fresh run.
      if (snapshotStart) {
        url.searchParams.set("snapshotStart", "true")
      }
    }

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

  const refreshRangeStateFromServer = useCallback(async (rangeId: string) => {
    if (!rangeId?.trim()) return
    try {
      const res = await fetch(
        `/api/range/pb-status?rangeId=${encodeURIComponent(rangeId.trim())}`,
        { cache: "no-store" },
      )
      if (!res.ok) return
      const data = (await res.json()) as { rangeState?: string }
      const rs = data.rangeState
      if (typeof rs === "string" && rs.trim()) {
        setRangeState(rs.trim().toUpperCase())
      }
    } catch {
      /* ignore network errors */
    }
  }, [])

  // Clean up on provider unmount
  useEffect(() => () => stopStreaming(), [stopStreaming])

  return (
    <DeployLogContext.Provider
      value={{
        lines,
        isStreaming,
        rangeState,
        activeRangeId,
        startStreaming,
        stopStreaming,
        clearLogs,
        refreshRangeStateFromServer,
      }}
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
