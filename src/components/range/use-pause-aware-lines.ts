import { useState, useRef, useEffect, useCallback } from "react"

/**
 * Freeze the visible log output at a snapshot while the stream keeps appending.
 * Resuming shows the full buffer instantly — no data is dropped.
 */
export function usePauseAwareLines(lines: string[]) {
  const [paused, setPaused] = useState(false)
  const freezeLenRef = useRef(0)

  // If lines shrink (cleared), auto-resume so the viewer doesn't stay stuck on a stale snapshot.
  useEffect(() => {
    if (paused && lines.length < freezeLenRef.current) {
      setPaused(false)
      freezeLenRef.current = 0
    }
  }, [lines.length, paused])

  const pause = useCallback((currentLen: number) => {
    freezeLenRef.current = currentLen
    setPaused(true)
  }, [])

  const resume = useCallback(() => {
    setPaused(false)
    freezeLenRef.current = 0
  }, [])

  const displayLines = paused ? lines.slice(0, freezeLenRef.current) : lines

  return { displayLines, paused, frozenAt: freezeLenRef.current, pause, resume }
}
