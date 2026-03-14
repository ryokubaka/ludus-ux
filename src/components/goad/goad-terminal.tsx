"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, Trash2, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

// Strip ANSI/VT100 codes so stored history with raw escape sequences renders cleanly.
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[^[\]]/g, "")
    .replace(/\x1b/g, "")
    .replace(/^.*\r(?!\n)/gm, "")
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
}

interface GoadTerminalProps {
  lines: string[]
  onClear?: () => void
  className?: string
  label?: string
}

const BOTTOM_THRESHOLD = 80 // px

export function GoadTerminal({ lines, onClear, className, label }: GoadTerminalProps) {
  const containerRef        = useRef<HTMLDivElement>(null)
  const userScrolledUpRef   = useRef(false)
  const prevScrollTopRef    = useRef(0)
  const prevLinesLenRef     = useRef(0)
  const [showJumpBtn, setShowJumpBtn] = useState(false)

  // Auto-scroll new lines into view
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const hasNew = lines.length > prevLinesLenRef.current
    prevLinesLenRef.current = lines.length

    if (lines.length === 0) {
      userScrolledUpRef.current = false
      prevScrollTopRef.current  = 0
      setShowJumpBtn(false)
      return
    }

    if (!userScrolledUpRef.current) {
      el.scrollTop = el.scrollHeight
      prevScrollTopRef.current = el.scrollTop
    } else if (hasNew) {
      setShowJumpBtn(true)
    }
  }, [lines])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return

    const isNearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD

    if (isNearBottom) {
      userScrolledUpRef.current = false
      setShowJumpBtn(false)
    } else if (el.scrollTop < prevScrollTopRef.current) {
      userScrolledUpRef.current = true
    }

    prevScrollTopRef.current = el.scrollTop
  }

  const scrollToBottom = () => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    prevScrollTopRef.current  = el.scrollTop
    userScrolledUpRef.current = false
    setShowJumpBtn(false)
  }

  const downloadLog = () => {
    const content = lines.join("\n")
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `goad-${new Date().toISOString().slice(0, 19)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const getLineClass = (line: string) => {
    const lower = line.toLowerCase()
    if (line.startsWith("[TASKID]")) return "hidden"
    if (lower.includes("[fatal]") || lower.includes("fatal:")) return "text-red-500 font-bold"
    if (lower.includes("[error]") || lower.includes("error:") || lower.includes("failed")) return "text-red-400"
    if (lower.includes("[warning]") || lower.includes("warn:")) return "text-yellow-400"
    if (lower.includes("[ok]") || lower.includes("ok:") || lower.includes("changed:")) return "text-green-400"
    if (lower.includes("[play]") || lower.includes("[task]") || lower.includes("[recap]")) return "text-cyan-400 font-semibold"
    if (lower.includes("[info]") || lower.includes("info:")) return "text-blue-400"
    if (lower.startsWith("=>") || lower.startsWith("->")) return "text-purple-400"
    if (lower.includes("[exit]")) return "text-yellow-500 font-bold"
    return "text-gray-300"
  }

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border border-gray-700 rounded-t-lg border-b-0 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-xs text-gray-400 font-mono ml-2">{label ?? "goad-mod terminal"}</span>
        </div>
        <div className="flex gap-1 items-center">
          <Button size="icon-sm" variant="ghost" onClick={downloadLog} disabled={lines.length === 0}>
            <Download className="h-3 w-3 text-gray-400" />
          </Button>
          {onClear && (
            <Button size="icon-sm" variant="ghost" onClick={onClear} disabled={lines.length === 0}>
              <Trash2 className="h-3 w-3 text-gray-400" />
            </Button>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="bg-gray-950 border border-gray-700 rounded-b-lg p-4 font-mono text-xs overflow-y-auto overflow-x-hidden min-h-[12rem] flex-1"
        >
          {lines.length === 0 ? (
            <p className="text-gray-600 italic">Waiting for output...</p>
          ) : (
            <pre className="m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {lines.map((line, i) => {
                const clean = stripAnsi(line)
                if (!clean.trim()) return null
                return (
                  <div key={i} className={getLineClass(clean)}>
                    {clean}
                  </div>
                )
              })}
            </pre>
          )}
        </div>

        {showJumpBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full
                       bg-gray-700/90 text-gray-200 text-xs font-mono shadow-lg
                       hover:bg-gray-600 transition-colors z-10"
          >
            <ArrowDown className="h-3 w-3" />
            new output
          </button>
        )}
      </div>
    </div>
  )
}

// ── useGoadStream ─────────────────────────────────────────────────────────────

/**
 * Hook for streaming GOAD command output via SSE.
 * Persists the active task ID in sessionStorage (keyed by storageKey) so that
 * switching pages and coming back can resume from the server-side task store.
 */
export function useGoadStream(storageKey?: string) {
  const [lines, setLines] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const initializedRef = useRef(false)

  // On mount: check sessionStorage for a persisted task and resume if present
  useEffect(() => {
    if (!storageKey || initializedRef.current) return
    initializedRef.current = true
    const savedTaskId = sessionStorage.getItem(storageKey)
    if (savedTaskId) {
      // Check if the task still exists and whether it's still running
      fetch(`/api/goad/tasks/${savedTaskId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((task) => {
          if (!task) return
          // Always show the historical output; if still running, stream it live
          resumeTask(savedTaskId)
        })
        .catch(() => {})
    }
  }, [storageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const connectToStream = useCallback(async (
    url: string,
    fetchOptions: RequestInit,
    captureTaskId: boolean
  ) => {
    setLines([])
    setExitCode(null)
    setIsRunning(true)

    try {
      const response = await fetch(url, fetchOptions)
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const newLines = chunk
          .split("\n")
          .filter((l) => l.startsWith("data: "))
          .map((l) => l.slice(6))

        for (const line of newLines) {
          // Capture task ID emitted by the execute route
          if (captureTaskId && line.startsWith("[TASKID] ")) {
            const tid = line.slice(9).trim()
            setTaskId(tid)
            if (storageKey) sessionStorage.setItem(storageKey, tid)
            continue // hide [TASKID] lines from display
          }
          if (line.startsWith("[EXIT] ")) {
            const code = parseInt(line.match(/code (\d+)/)?.[1] || "0")
            setExitCode(code)
          }
          setLines((prev) => [...prev, line])
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setLines((prev) => [...prev, `[ERROR] ${(err as Error).message}`])
      }
    } finally {
      setIsRunning(false)
    }
  }, [storageKey])

  const run = useCallback(async (
    args: string,
    instanceId?: string,
    impersonateAs?: { username: string; apiKey: string },
    /** Dedicated Ludus rangeID — injected as LUDUS_RANGE_ID so GOAD targets
     *  only this instance's range, leaving other ranges untouched. */
    rangeId?: string
  ) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setTaskId(null)

    await connectToStream(
      "/api/goad/execute",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args, instanceId, impersonateAs, rangeId }),
        signal: controller.signal,
      },
      true
    )
  }, [connectToStream])

  const resumeTask = useCallback(async (tid: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setTaskId(tid)

    await connectToStream(
      `/api/goad/tasks/${tid}/stream`,
      { signal: controller.signal },
      false
    )
  }, [connectToStream])

  const stop = useCallback(async () => {
    // Capture current taskId before any state updates
    const tid = taskId
    if (tid) {
      // Ask the server to kill the SSH/ansible process. This works even when
      // the original SSE connection (execute route) has already disconnected,
      // e.g. after sign-out/back-in + resume.
      try {
        await fetch(`/api/goad/tasks/${tid}/stop`, { method: "POST" })
      } catch {
        // Best-effort; continue to tear down the client side regardless
      }
    }
    abortRef.current?.abort()
    setIsRunning(false)
  }, [taskId])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setLines([])
    setExitCode(null)
    setTaskId(null)
    setIsRunning(false)
    if (storageKey) sessionStorage.removeItem(storageKey)
  }, [storageKey])

  return { lines, isRunning, exitCode, taskId, run, resumeTask, stop, clear }
}
