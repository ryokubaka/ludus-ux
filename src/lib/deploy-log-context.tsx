"use client"

import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from "react"
import { ludusApi } from "@/lib/api"
import { appendStreamLines } from "@/lib/log-buffer"
import { isBlankDeployLogLine, omitBlankLogLines, stampDeployLogForDisplay, stampObservedDeployLines } from "@/lib/log-line-timestamp"
import { splitLogText } from "@/lib/strip-ansi"
import { fetchDeployLogClock } from "@/lib/deploy-log-clock"
import { pickLatestDeployHistoryEntry } from "@/lib/range-deploy-elapsed-anchor"
import { extractArray } from "@/lib/utils"
import type { LogHistoryEntry } from "@/lib/types"

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

  const abortRef = useRef<AbortController | null>(null)
  const isStreamingRef = useRef(false)
  const targetRangeRef = useRef<string | undefined>(undefined)
  const intentionalStopRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const streamStartedAtRef = useRef<number | null>(null)
  const historyLogIdRef = useRef("")
  const observedLinesRef = useRef<string[]>([])
  const startStreamingRef = useRef<(rangeId?: string, opts?: StartRangeStreamOptions) => void>(() => {})

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (snapshotTimerRef.current) {
      clearInterval(snapshotTimerRef.current)
      snapshotTimerRef.current = null
    }
  }, [])

  const stopStreaming = useCallback(() => {
    intentionalStopRef.current = true
    clearReconnectTimer()
    reconnectAttemptRef.current = 0
    abortRef.current?.abort()
    abortRef.current = null
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
    clearReconnectTimer()
    abortRef.current?.abort()
    abortRef.current = null

    const isReconnect = Boolean(opts?.reconnect)
    if (!isReconnect) {
      intentionalStopRef.current = false
      reconnectAttemptRef.current = 0
      historyLogIdRef.current = ""
      observedLinesRef.current = []
    }

    const snapshotStart = opts?.snapshotStart ?? (isReconnect ? false : Boolean(rangeId))
    const anchor =
      typeof opts?.deployElapsedAnchorMs === "number" && Number.isFinite(opts.deployElapsedAnchorMs)
        ? opts.deployElapsedAnchorMs
        : isReconnect && streamStartedAtRef.current != null
          ? streamStartedAtRef.current
          : Date.now()
    /** Per-connection id — targetRangeRef updates before an older read can reconnect. */
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
    if (streamRangeId) {
      // History already has the running deploy text. The live stream can stay
      // empty until that connection finishes, so read the same record on a timer.
      const pullHistory = async () => {
        if (intentionalStopRef.current || targetRangeRef.current?.trim() !== streamRangeId) return
        try {
          const listed = await ludusApi.getRangeLogHistory(streamRangeId)
          const entries = extractArray<LogHistoryEntry>(listed.data as unknown)
          const running = pickLatestDeployHistoryEntry(entries)
          if (!running) return
          const [detail, generations] = await Promise.all([
            ludusApi.getRangeLogHistoryById(running.id, streamRangeId),
            fetchDeployLogClock(streamRangeId),
          ])
          const text = detail.data?.result
          if (!text) return
          const raw = omitBlankLogLines(splitLogText(text))
          const logChanged = historyLogIdRef.current !== running.id
          if (logChanged) {
            historyLogIdRef.current = running.id
            observedLinesRef.current = []
          }
          const now = Date.now()
          // First paint spreads the backlog across the run. Lines that arrive
          // after that keep the time this pane first saw them.
          const stamped =
            observedLinesRef.current.length === 0
              ? stampDeployLogForDisplay(raw, generations, running.start, running.end, now)
              : stampObservedDeployLines(observedLinesRef.current, raw, now)
          observedLinesRef.current = stamped
          setLines((prev) => {
            if (!logChanged && stamped.length < prev.length) return prev
            return stamped
          })
        } catch {
          /* the open stream still owns state updates */
        }
      }
      void pullHistory()
      snapshotTimerRef.current = setInterval(() => {
        void pullHistory()
      }, 2000)
    }

    const url = new URL("/api/logs/stream", window.location.origin)
    if (rangeId) {
      url.searchParams.set("rangeId", rangeId)
      // snapshotStart: see StartRangeStreamOptions — default true for a fresh run.
      if (snapshotStart) {
        url.searchParams.set("snapshotStart", "true")
      }
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl
    const accept = (raw: string) => {
      // Keepalive so a quiet deploy does not look like a dead stream.
      if (raw === "[PING]") return
      if (raw.startsWith("[STATE] ")) {
        setRangeState(raw.slice(8).trim())
        reconnectAttemptRef.current = 0
      } else if (raw.startsWith("[DONE] ")) {
        setRangeState(raw.slice(7).trim())
        stopStreaming()
      } else if (raw.startsWith("[ERROR] ")) {
        setLines((prev) => appendStreamLines(prev, raw))
        stopStreaming()
      } else if (raw.startsWith("[LUDUS] ") || raw.startsWith("[GOAD] ")) {
        // The history poll owns the pane. A buffered stream would append the same lines again.
        if (snapshotTimerRef.current) return
        if (!isBlankDeployLogLine(raw)) {
          setLines((prev) => appendStreamLines(prev, raw))
        }
        reconnectAttemptRef.current = 0
      }
    }
    // EventSource reports a closed stream as a failure and never shows the
    // lines that already arrived. fetch reads those bytes, then reconnects
    // only when the body never started.
    void (async () => {
      let sawLine = false
      try {
        const res = await fetch(url.toString(), { signal: ctrl.signal, credentials: "same-origin" })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const parts = buf.split("\n")
          buf = parts.pop() ?? ""
          for (const line of parts) {
            if (!line.startsWith("data: ")) continue
            sawLine = true
            accept(line.slice(6))
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError" || intentionalStopRef.current) return
      }
      if (intentionalStopRef.current || !isStreamingRef.current) {
        isStreamingRef.current = false
        setIsStreaming(false)
        return
      }
      if (streamRangeId) void refreshRangeStateFromServer(streamRangeId)
      if (abortRef.current === ctrl) abortRef.current = null
      const attempt = reconnectAttemptRef.current + 1
      if (attempt > RECONNECT_MAX_ATTEMPTS || !streamRangeId) {
        isStreamingRef.current = false
        setIsStreaming(false)
        if (!sawLine) {
          setLines((prev) =>
            appendStreamLines(prev, "[ERROR] Deploy log stream disconnected and could not auto-reconnect."),
          )
        }
        return
      }
      reconnectAttemptRef.current = attempt
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(1.5, attempt - 1), RECONNECT_MAX_MS)
      if (!sawLine) {
        setLines((prev) =>
          appendStreamLines(
            prev,
            `[LUDUS] Log stream blip — reconnecting in ${Math.round(delay / 1000)}s (attempt ${attempt}/${RECONNECT_MAX_ATTEMPTS})…`,
          ),
        )
      }
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
    })()
  }, [stopStreaming, refreshRangeStateFromServer, clearReconnectTimer])

  startStreamingRef.current = startStreaming

  const clearLogs = useCallback(() => {
    setLines([])
    setRangeState(null)
    setActiveRangeId(null)
    setStreamStartedAt(null)
    streamStartedAtRef.current = null
    historyLogIdRef.current = ""
    observedLinesRef.current = []
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
