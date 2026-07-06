"use client"

import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from "react"
import { appendStreamLines } from "@/lib/log-buffer"

export type StartRangeStreamOptions = {
  /**
   * When true (default for a new stream with rangeId), the server skips log lines
   * that already exist at connection time — only NEW output appears (good for a
   * fresh deploy). When false, the full current Ludus log buffer is emitted first
   * (needed after refresh / navigation so the panel is not blank until the next line).
   */
  snapshotStart?: boolean
  /**
   * Unix ms when the **current** Ludus deploy began (e.g. from deploy log history).
   * When set, the Deploy Logs elapsed timer survives refresh. Omit to use the
   * moment the EventSource opens (`Date.now()`).
   */
  deployElapsedAnchorMs?: number
}

interface DeployLogContextValue {
  lines: string[]
  isStreaming: boolean
  rangeState: string | null
  /** The rangeId currently being streamed (null when idle). */
  activeRangeId: string | null
  /** Unix-ms timestamp of when the current stream started (null when idle). */
  streamStartedAt: number | null
  startStreaming: (rangeId?: string, opts?: StartRangeStreamOptions) => void
  stopStreaming: () => void
  clearLogs: () => void
  /**
   * Re-read rangeState from PocketBase (GET /api/range/pb-status) so the Deploy
   * Status badge updates immediately after abort / external state changes — the
   * SSE stream alone does not push a new [STATE] after the connection closed.
   */
  /** Returns normalized PocketBase rangeState, or null if unavailable. */
  refreshRangeStateFromServer: (rangeId: string) => Promise<string | null>
}

const DeployLogContext = createContext<DeployLogContextValue | null>(null)

export function DeployLogProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [rangeState, setRangeState] = useState<string | null>(null)
  const [activeRangeId, setActiveRangeId] = useState<string | null>(null)
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null)

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

  const refreshRangeStateFromServer = useCallback(async (rangeId: string): Promise<string | null> => {
    if (!rangeId?.trim()) return null
    try {
      const res = await fetch(
        `/api/range/pb-status?rangeId=${encodeURIComponent(rangeId.trim())}`,
        { cache: "no-store" },
      )
      if (!res.ok) return null
      const data = (await res.json()) as { rangeState?: string }
      const rs = data.rangeState
      if (typeof rs === "string" && rs.trim()) {
        const upper = rs.trim().toUpperCase()
        setRangeState(upper)
        return upper
      }
    } catch {
      /* ignore network errors */
    }
    return null
  }, [])

  const startStreaming = useCallback((rangeId?: string, opts?: StartRangeStreamOptions) => {
    // Close any previous connection first
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    const snapshotStart = opts?.snapshotStart ?? Boolean(rangeId)
    const anchor =
      typeof opts?.deployElapsedAnchorMs === "number" && Number.isFinite(opts.deployElapsedAnchorMs)
        ? opts.deployElapsedAnchorMs
        : Date.now()
    /** Per-connection id — targetRangeRef updates before old EventSource onerror may run. */
    const streamRangeId = rangeId?.trim() ?? ""

    targetRangeRef.current = rangeId
    isStreamingRef.current = true
    setActiveRangeId(rangeId ?? null)
    setIsStreaming(true)
    setRangeState(null)
    setLines([])
    setStreamStartedAt(anchor)

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
        const s = raw.slice(8).trim()
        setRangeState(s)
      } else if (raw.startsWith("[DONE] ")) {
        // Server signals deploy finished (SUCCESS / ERROR / ABORTED / etc.)
        const s = raw.slice(7).trim()
        setRangeState(s)
        stopStreaming()
      } else if (raw.startsWith("[ERROR] ")) {
        // Server-side error — surface it as a log line and stop
        setLines((prev) => appendStreamLines(prev, raw))
        stopStreaming()
      } else if (raw.startsWith("[LUDUS] ")) {
        setLines((prev) => appendStreamLines(prev, raw))
      } else if (raw.startsWith("[GOAD] ")) {
        setLines((prev) => appendStreamLines(prev, raw))
      }
      // Unknown prefix: silently ignore to stay forward-compatible
    }

    es.onerror = () => {
      if (streamRangeId) void refreshRangeStateFromServer(streamRangeId)
      // The server closed the connection (stream finished) or a network error
      // occurred.  Either way, mark streaming as done so the UI can react.
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      isStreamingRef.current = false
      setIsStreaming(false)
    }
  }, [stopStreaming, refreshRangeStateFromServer])

  const clearLogs = useCallback(() => {
    setLines([])
    setRangeState(null)
    setActiveRangeId(null)
    setStreamStartedAt(null)
  }, [])

  // Clean up on provider unmount
  useEffect(() => () => stopStreaming(), [stopStreaming])

  const value = useMemo<DeployLogContextValue>(
    () => ({
      lines,
      isStreaming,
      rangeState,
      activeRangeId,
      streamStartedAt,
      startStreaming,
      stopStreaming,
      clearLogs,
      refreshRangeStateFromServer,
    }),
    [
      lines,
      isStreaming,
      rangeState,
      activeRangeId,
      streamStartedAt,
      startStreaming,
      stopStreaming,
      clearLogs,
      refreshRangeStateFromServer,
    ],
  )

  return <DeployLogContext.Provider value={value}>{children}</DeployLogContext.Provider>
}

export function useDeployLogContext() {
  const ctx = useContext(DeployLogContext)
  if (!ctx) throw new Error("useDeployLogContext must be used within DeployLogProvider")
  return ctx
}
