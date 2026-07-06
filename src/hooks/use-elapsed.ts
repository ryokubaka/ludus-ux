"use client"

import { useState, useEffect } from "react"
import { formatElapsed } from "@/lib/utils"

/**
 * One shared 1-second interval drives every active `useElapsed` instead of each
 * row spinning up its own `setInterval`. The interval only runs while at least
 * one subscriber is active and is torn down when the last one unsubscribes.
 */
const secondSubscribers = new Set<() => void>()
let secondTimer: ReturnType<typeof setInterval> | null = null

function subscribeSecond(cb: () => void): () => void {
  secondSubscribers.add(cb)
  if (secondTimer === null) {
    secondTimer = setInterval(() => {
      for (const fn of secondSubscribers) fn()
    }, 1000)
  }
  return () => {
    secondSubscribers.delete(cb)
    if (secondSubscribers.size === 0 && secondTimer !== null) {
      clearInterval(secondTimer)
      secondTimer = null
    }
  }
}

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
    setElapsed(formatElapsed(Date.now() - startedAt))
    return subscribeSecond(() => setElapsed(formatElapsed(Date.now() - startedAt)))
  }, [startedAt])

  return elapsed
}
