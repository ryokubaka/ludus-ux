"use client"

import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from "react"
import { appendStreamLines } from "@/lib/log-buffer"

export type StartRangeStreamOptions = {
  /**
   * When true (default for a new stream with rangeId), the server skips log lines
   * that already exist at connection time — only NEW output appears (good for a
   * fresh deploy). When false, the full current Ludus log buffer is emitted first
   * (needed after refresh / navigation / reconnect so the panel is not blank).
   */
  snapshotStart?: boolean
  /**
   * Unix ms when the **current** Ludus deploy began (e.g. from deploy log history).
   * When set, the Deploy Logs elapsed timer survives refresh. Omit to use the
   * moment the EventSource opens (`Date.now()`).
   */
  deployElapsedAnchorMs?: number
  /**
   * When true, keep existing log lines and do not reset the elapsed timer.
   * Used for automatic reconnect after a transient SSE blip.
   */
  reconnect?: boolean
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

const RECONNECT_BASE_MS = 1500
const RECONNECT_MAX_MS = 15000
const RECONNECT_MAX_ATTEMPTS = 40

export function DeployLogProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [rangeState, setRangeState] = useState<string | null>(null)
  const [activeRangeId, setActiveRangeId] = useState<string | null>(null)
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null)

  const esRef = useRef<EventSource | null>(null)
  const isStreamingRef = useRef(false)
  const targetRangeRef = useRef<string | undefined>(undefined)
  const intentionalStopRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const streamStartedAtRef = useRef<number | null>(null)
  const startStreamingRef = useRef<(rangeId?: string, opts?: StartRangeStreamOptions) => void>(() => {})

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const stopStreaming = useCallback(() => {
    intentionalStopRef.current = true
    clearReconnectTimer()
    reconnectAttemptRef.current = 0
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    isStreamingRef.current = false
    setIsStreaming(false)
  }, [clearReconnectTimer])

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
    // Close any previous connection first (strip handlers so close() cannot schedule reconnect)
    clearReconnectTimer()
    if (esRef.current) {
      const prev = esRef.current
      esRef.current = null
      prev.onerror = null
      prev.onmessage = null
      prev.close()
    }

    const isReconnect = Boolean(opts?.reconnect)
    if (!isReconnect) {
      intentionalStopRef.current = false
      reconnectAttemptRef.current = 0
    }

    const snapshotStart = opts?.snapshotStart ?? (isReconnect ? false : Boolean(rangeId))
    const anchor =
      typeof opts?.deployElapsedAnchorMs === "number" && Number.isFinite(opts.deployElapsedAnchorMs)
        ? opts.deployElapsedAnchorMs
        : isReconnect && streamStartedAtRef.current != null
          ? streamStartedAtRef.current
          : Date.now()
    /** Per-connection id — targetRangeRef updates before old EventSource onerror may run. */
    const streamRangeId = rangeId?.trim() ?? ""

    targetRangeRef.current = rangeId
    intentionalStopRef.current = false
    isStreamingRef.current = true
    setActiveRangeId(rangeId ?? null)
    setIsStreaming(true)
    if (!isReconnect) {
      setRangeState(null)
      setLines([])
      setStreamStartedAt(anchor)
      streamStartedAtRef.current = anchor
    } else if (streamStartedAtRef.current == null) {
      setStreamStartedAt(anchor)
      streamStartedAtRef.current = anchor
    }

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
        reconnectAttemptRef.current = 0
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
        reconnectAttemptRef.current = 0
      } else if (raw.startsWith("[GOAD] ")) {
        setLines((prev) => appendStreamLines(prev, raw))
        reconnectAttemptRef.current = 0
      }
      // Unknown prefix: silently ignore to stay forward-compatible
    }

    es.onerror = () => {
      if (streamRangeId) void refreshRangeStateFromServer(streamRangeId)

      if (esRef.current === es) {
        es.close()
        esRef.current = null
      }

      // User/stopStreaming or terminal [DONE]/[ERROR] — do not reconnect.
      if (intentionalStopRef.current || !isStreamingRef.current) {
        isStreamingRef.current = false
        setIsStreaming(false)
        return
      }

      const attempt = reconnectAttemptRef.current + 1
      if (attempt > RECONNECT_MAX_ATTEMPTS || !streamRangeId) {
        isStreamingRef.current = false
        setIsStreaming(false)
        setLines((prev) =>
          appendStreamLines(
            prev,
            "[ERROR] Deploy log stream disconnected and could not auto-reconnect.",
          ),
        )
        return
      }

      reconnectAttemptRef.current = attempt
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(1.5, attempt - 1), RECONNECT_MAX_MS)
      setLines((prev) =>
        appendStreamLines(
          prev,
          `[LUDUS] Log stream blip — reconnecting in ${Math.round(delay / 1000)}s (attempt ${attempt}/${RECONNECT_MAX_ATTEMPTS})…`,
        ),
      )
      // Keep isStreaming true while we wait to reconnect
      clearReconnectTimer()
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        if (intentionalStopRef.current) return
        const rid = targetRangeRef.current
        if (!rid) {
          isStreamingRef.current = false
          setIsStreaming(false)
          return
        }
        startStreamingRef.current(rid, {
          reconnect: true,
          snapshotStart: false,
          deployElapsedAnchorMs: streamStartedAtRef.current ?? undefined,
        })
      }, delay)
    }
  }, [stopStreaming, refreshRangeStateFromServer, clearReconnectTimer])

  startStreamingRef.current = startStreaming

  const clearLogs = useCallback(() => {
    setLines([])
    setRangeState(null)
    setActiveRangeId(null)
    setStreamStartedAt(null)
    streamStartedAtRef.current = null
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
