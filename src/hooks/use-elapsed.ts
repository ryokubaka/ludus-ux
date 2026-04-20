"use client"

import { useState, useEffect } from "react"
import { formatElapsed } from "@/lib/utils"

/**
 * Returns a live-updating formatted elapsed-time string (e.g. "2m 15s") for a
 * running task. Updates every second while `startedAt` is non-null; returns
 * null otherwise so callers can hide the element entirely when idle.
 */
export function useElapsed(startedAt: number | null): string | null {
  const [elapsed, setElapsed] = useState<string | null>(
    startedAt !== null ? formatElapsed(Date.now() - startedAt) : null
  )

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(null)
      return
    }
    const tick = () => setElapsed(formatElapsed(Date.now() - startedAt))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  return elapsed
}
