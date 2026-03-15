"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { ludusApi } from "@/lib/api"

const POLL_INTERVAL_MS = 5000

interface UseDeployLogsOptions {
  onComplete?: () => void
}

export function useDeployLogs(options: UseDeployLogsOptions = {}) {
  const [lines, setLines] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [rangeState, setRangeState] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastCountRef = useRef(0)
  const isStreamingRef = useRef(false)
  const onCompleteRef = useRef(options.onComplete)
  onCompleteRef.current = options.onComplete

  const stopStreaming = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    isStreamingRef.current = false
    setIsStreaming(false)
  }, [])

  // Stop the interval when the component that owns this hook unmounts
  useEffect(() => () => stopStreaming(), [stopStreaming])

  const startStreaming = useCallback((rangeId?: string) => {
    stopStreaming()
    lastCountRef.current = 0
    isStreamingRef.current = true
    setIsStreaming(true)
    setRangeState(null)

    const poll = async () => {
      // Skip fetches when the tab is not visible
      if (typeof document !== "undefined" && document.hidden) return
      if (!isStreamingRef.current) return

      try {
        const [logsResult, rangeResult] = await Promise.all([
          ludusApi.getRangeLogs(rangeId),
          ludusApi.getRangeStatus(rangeId),
        ])

        if (logsResult.data) {
          const raw = (logsResult.data as { result?: string }).result ?? ""
          const allLines = raw.split("\n").filter((l) => l.trim())
          const newLines = allLines.slice(lastCountRef.current)
          lastCountRef.current = allLines.length
          if (newLines.length > 0) {
            setLines((prev) => [...prev, ...newLines])
          }
        }

        const state = (rangeResult.data as { rangeState?: string } | null)?.rangeState
        if (state) setRangeState(state)
        if (state && state !== "DEPLOYING" && state !== "WAITING") {
          stopStreaming()
          onCompleteRef.current?.()
        }
      } catch {
        // Network hiccup — keep polling
      }
    }

    poll()
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS)
  }, [stopStreaming])

  const clearLogs = useCallback(() => {
    setLines([])
    lastCountRef.current = 0
    setRangeState(null)
  }, [])

  return { lines, isStreaming, rangeState, startStreaming, stopStreaming, clearLogs }
}
