"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LogViewer } from "@/components/range/log-viewer"
import { Activity, RefreshCw, Trash2, Download } from "lucide-react"
import { ludusApi, getImpersonationApiKey } from "@/lib/api"
import { useRange } from "@/lib/range-context"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export default function LogsPage() {
  const { toast } = useToast()
  const { selectedRangeId } = useRange()
  const [lines, setLines] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [rangeState, setRangeState] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Fetch a fresh static snapshot — used by the Refresh button after streaming ends
  const loadLogs = useCallback(async () => {
    setLoading(true)
    const [logResult, rangeResult] = await Promise.all([
      ludusApi.getRangeLogs(),
      ludusApi.getRangeStatus(),
    ])
    if (logResult.data) {
      const text = logResult.data.result || ""
      setLines(text.split("\n").filter((l) => l.trim()))
    } else if (logResult.error) {
      toast({ variant: "destructive", title: "Failed to load logs", description: logResult.error })
    }
    if (rangeResult.data) setRangeState(rangeResult.data.rangeState)
    setLoading(false)
  }, [toast])

  // Start (or restart) live streaming
  const startStreaming = useCallback(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLines([])
    setIsStreaming(true)

    ;(async () => {
      try {
        const impKey = getImpersonationApiKey()
        const headers: Record<string, string> = {}
        if (impKey) headers["X-Impersonate-Apikey"] = impKey

        const streamUrl = selectedRangeId
          ? `/api/logs/stream?rangeId=${selectedRangeId}`
          : "/api/logs/stream"
        const res = await fetch(streamUrl, { signal: ctrl.signal, headers })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = dec.decode(value, { stream: true })
          const newLines = chunk
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6))
          // Update state badge from server-pushed STATE/DONE events; filter
          // internal control lines so they never appear as log output.
          const displayLines = newLines.filter(
            (l) => !l.startsWith("[STATE] ") && !l.startsWith("[DONE] ")
          )
          if (displayLines.length) setLines((prev) => [...prev, ...displayLines])
          // [DONE] <state> — new sentinel (replaces legacy [DEPLOY_COMPLETE])
          const doneLine = newLines.find((l) => l.startsWith("[DONE] "))
          if (doneLine) {
            setRangeState(doneLine.slice(7).trim())
            loadLogs()
          }
          // [STATE] <state> — intermediate state update
          const stateLine = newLines.findLast?.((l) => l.startsWith("[STATE] ")) ??
            [...newLines].reverse().find((l) => l.startsWith("[STATE] "))
          if (stateLine) {
            setRangeState(stateLine.slice(8).trim())
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return
      } finally {
        setIsStreaming(false)
      }
    })()
  }, [loadLogs, selectedRangeId])

  const clearLogs = useCallback(() => setLines([]), [])

  const downloadLogs = useCallback(() => {
    const content = lines.join("\n")
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ludus-logs-${new Date().toISOString().slice(0, 19)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }, [lines])

  // Always start streaming on mount — the stream polls the Ludus API every 2s
  // and self-terminates when the range is no longer deploying, so this works
  // correctly both when a deployment is in progress and when it is not.
  useEffect(() => {
    startStreaming()
    return () => abortRef.current?.abort()
  }, [startStreaming])

  const isDeploying = rangeState === "DEPLOYING" || rangeState === "WAITING"

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className={cn("h-4 w-4", isStreaming ? "text-green-400 animate-pulse" : "text-primary")} />
              Range Logs
              {isStreaming && <Badge variant="success" className="text-xs">Live</Badge>}
              {isDeploying && !isStreaming && (
                <Badge variant="warning" className="text-xs">Deploying</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={loadLogs} disabled={loading || isStreaming} className="gap-1.5">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Refresh
              </Button>
              <Button size="sm" variant="ghost" onClick={downloadLogs} disabled={!lines.length} title="Download">
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={clearLogs} disabled={!lines.length} title="Clear">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground mb-3 flex items-center gap-4">
            <span>{lines.length} lines</span>
            {rangeState && (
              <span>Range: <code className="font-mono">{rangeState}</code></span>
            )}
            {isStreaming && (
              <span className="flex items-center gap-1 text-green-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                Live — auto-stops when deployment completes
              </span>
            )}
          </div>
          <LogViewer
            lines={lines}
            autoScroll={isStreaming}
            maxHeight="calc(100vh - 280px)"
          />
        </CardContent>
      </Card>
    </div>
  )
}
