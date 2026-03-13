"use client"

import { useState, useRef, useCallback } from "react"
import { ludusApi } from "@/lib/api"

interface UseDeployLogsOptions {
  onComplete?: () => void
}

export function useDeployLogs(options: UseDeployLogsOptions = {}) {
  const [lines, setLines] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastCountRef = useRef(0)
  const onCompleteRef = useRef(options.onComplete)
  onCompleteRef.current = options.onComplete

  const stopStreaming = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setIsStreaming(false)
  }, [])

  const startStreaming = useCallback(() => {
    stopStreaming()
    lastCountRef.current = 0
    setIsStreaming(true)

    const poll = async () => {
      try {
        const [logsResult, rangeResult] = await Promise.all([
          ludusApi.getRangeLogs(),
          ludusApi.getRangeStatus(),
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
        if (state && state !== "DEPLOYING" && state !== "WAITING") {
          stopStreaming()
          onCompleteRef.current?.()
        }
      } catch {
        // Network hiccup — keep polling
      }
    }

    // Immediate first poll, then every 2 s
    poll()
    timerRef.current = setInterval(poll, 2000)
  }, [stopStreaming])

  const clearLogs = useCallback(() => {
    setLines([])
    lastCountRef.current = 0
  }, [])

  return { lines, isStreaming, startStreaming, stopStreaming, clearLogs }
}
