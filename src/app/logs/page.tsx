"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LogViewer } from "@/components/range/log-viewer"
import { PaginatedLogHistoryList } from "@/components/range/log-history-list"
import { VmOperationLogList } from "@/components/range/vm-operation-log-list"
import { Activity, RefreshCw, Trash2, Download, History, ArrowLeft, ShieldAlert } from "lucide-react"
import { ludusApi, getImpersonationApiKey, getImpersonationHeaders, getVmOperationLog } from "@/lib/api"
import {
  type GoadTaskForCorrelation,
  correlateHistoryEntries,
  aggregateDeployStatuses,
} from "@/lib/goad-deploy-history-correlation"
import { useRange } from "@/lib/range-context"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export default function LogsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { selectedRangeId } = useRange()
  const [lines, setLines] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [rangeState, setRangeState] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // ── History state ─────────────────────────────────────────────────────────
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
  const [historyLines, setHistoryLines] = useState<string[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const { data: historyEntries = [], isLoading: historyListLoading, isFetching: historyRefreshing } = useQuery({
    queryKey: queryKeys.rangeLogHistory(selectedRangeId),
    queryFn: async () => {
      const result = await ludusApi.getRangeLogHistory(selectedRangeId ?? undefined)
      return result.data ?? []
    },
    staleTime: STALE.short,
  })

  const { data: goadInstanceForRange = null } = useQuery({
    queryKey: queryKeys.goadInstanceForRange(selectedRangeId ?? ""),
    queryFn: async () => {
      if (!selectedRangeId) return null
      const res = await fetch(`/api/goad/by-range?rangeId=${encodeURIComponent(selectedRangeId)}`)
      if (!res.ok) return null
      const data = (await res.json()) as { instanceId?: string | null }
      return data.instanceId && typeof data.instanceId === "string" ? data.instanceId : null
    },
    enabled: !!selectedRangeId,
    staleTime: STALE.short,
  })

  const { data: goadTasksForRange, isLoading: goadTasksListLoading } = useQuery({
    queryKey: [...queryKeys.goadTasks(), "for-instance", goadInstanceForRange ?? ""],
    queryFn: async () => {
      const iid = goadInstanceForRange!
      const res = await fetch("/api/goad/tasks", { headers: getImpersonationHeaders() })
      if (!res.ok) return [] as GoadTaskForCorrelation[]
      const data = (await res.json()) as { tasks?: GoadTaskForCorrelation[] }
      const all = data.tasks ?? []
      return all.filter((t) => t.instanceId === iid || t.command.includes(iid))
    },
    enabled: !!goadInstanceForRange,
    staleTime: STALE.short,
  })

  // ── VM operation audit log (destroy_vm / remove_extension) ───────────────
  const {
    data: vmOperationEntries = [],
    isLoading: vmOperationLoading,
    isFetching: vmOperationRefreshing,
  } = useQuery({
    queryKey: queryKeys.vmOperationLog(selectedRangeId),
    queryFn: async () => {
      const res = await getVmOperationLog({ rangeId: selectedRangeId ?? undefined })
      return res.entries
    },
    enabled: !!selectedRangeId,
    staleTime: STALE.short,
  })

  const handleSelectLog = useCallback(async (logId: string) => {
    setSelectedLogId(logId)
    setHistoryLines([])
    setHistoryLoading(true)
    const tasks = goadTasksForRange ?? []
    const row = correlateHistoryEntries(historyEntries, tasks).find(
      (c) => c.deployEntry?.id === logId || c.mergedBatchDeploys?.some((d) => d.id === logId),
    )
    const deployIds =
      row?.mergedBatchDeploys && row.mergedBatchDeploys.length > 0
        ? [...row.mergedBatchDeploys]
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
            .map((d) => d.id)
        : [logId]
    const lines: string[] = []
    for (const id of deployIds) {
      const result = await ludusApi.getRangeLogHistoryById(id, selectedRangeId ?? undefined)
      if (result.data?.result) {
        if (deployIds.length > 1) lines.push(`--- Ludus range deploy ${id} ---`)
        lines.push(...result.data.result.split("\n").filter((l) => l.trim()))
      } else if (result.error && deployIds.length === 1) {
        toast({ variant: "destructive", title: "Failed to load log", description: result.error })
      }
    }
    setHistoryLines(lines)
    setHistoryLoading(false)
  }, [selectedRangeId, toast, historyEntries, goadTasksForRange])

  const clearHistorySelection = useCallback(() => {
    setSelectedLogId(null)
    setHistoryLines([])
  }, [])

  // Clear history selection when range changes
  useEffect(() => {
    clearHistorySelection()
  }, [selectedRangeId, clearHistorySelection])

  // Refresh VM operation list when any page writes a new audit row
  // (Dashboard per-VM destroy, GOAD remove-extension, this-page destroy, ...).
  useEffect(() => {
    const handler = () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.vmOperationLog(selectedRangeId) })
    window.addEventListener("vm-operation-log-updated", handler)
    return () => window.removeEventListener("vm-operation-log-updated", handler)
  }, [queryClient, selectedRangeId])

  // ── Live streaming (existing) ─────────────────────────────────────────────

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
          const displayLines = newLines.filter(
            (l) => !l.startsWith("[STATE] ") && !l.startsWith("[DONE] ")
          )
          if (displayLines.length) setLines((prev) => [...prev, ...displayLines])
          const doneLine = newLines.find((l) => l.startsWith("[DONE] "))
          if (doneLine) {
            setRangeState(doneLine.slice(7).trim())
            loadLogs()
            queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(selectedRangeId) })
          }
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
  }, [loadLogs, selectedRangeId, queryClient])

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

  useEffect(() => {
    startStreaming()
    return () => abortRef.current?.abort()
  }, [startStreaming])

  const isDeploying = rangeState === "DEPLOYING" || rangeState === "WAITING"

  return (
    <div className="space-y-5">
      {/* Live / current deploy logs */}
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
            maxHeight="calc(100vh - 560px)"
          />
        </CardContent>
      </Card>

      {/* Deploy History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Deploy History
            {historyEntries.length > 0 && (
              <Badge variant="secondary" className="text-xs">{historyEntries.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedLogId ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={clearHistorySelection} className="gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to list
                </Button>
                {(() => {
                  const row = correlateHistoryEntries(historyEntries, goadTasksForRange ?? []).find(
                    (c) =>
                      c.deployEntry?.id === selectedLogId ||
                      c.mergedBatchDeploys?.some((d) => d.id === selectedLogId),
                  )
                  const st =
                    row?.mergedBatchDeploys?.length && row.mergedBatchDeploys.length > 0
                      ? aggregateDeployStatuses(row.mergedBatchDeploys)
                      : historyEntries.find((e) => e.id === selectedLogId)?.status
                  if (!st) return null
                  const t = st.toLowerCase()
                  return (
                    <Badge
                      variant={
                        t === "success" ? "success" : t === "running" || t === "waiting" ? "warning" : "destructive"
                      }
                      className="text-xs capitalize"
                    >
                      {st}
                    </Badge>
                  )
                })()}
              </div>
              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <LogViewer lines={historyLines} autoScroll={false} maxHeight="400px" />
              )}
            </div>
          ) : (
            <PaginatedLogHistoryList
              paginationResetKey={selectedRangeId ?? ""}
              allEntries={historyEntries}
              loading={historyListLoading}
              onSelect={handleSelectLog}
              selectedId={selectedLogId}
              goadInstanceId={goadInstanceForRange}
              goadTasks={
                goadInstanceForRange
                  ? goadTasksListLoading
                    ? undefined
                    : (goadTasksForRange ?? [])
                  : undefined
              }
              onRefresh={() => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(selectedRangeId) })
                void queryClient.invalidateQueries({ queryKey: queryKeys.goadTasks() })
              }}
              refreshing={historyRefreshing || (!!goadInstanceForRange && goadTasksListLoading)}
              emptyMessage="No deploy history for this range"
            />
          )}
        </CardContent>
      </Card>

      {/* VM Operations — LUX-local audit log for per-VM destroys and GOAD
          extension removals (writes happen from Dashboard / GOAD pages; this is
          read-only). Scoped to the currently selected range; non-admins only
          see their own rows. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" />
            VM Operations
            {vmOperationEntries.length > 0 && (
              <Badge variant="secondary" className="text-xs">{vmOperationEntries.length}</Badge>
            )}
            <span className="text-[11px] text-muted-foreground font-normal">
              — VM destroys & GOAD extension removals
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VmOperationLogList
            entries={vmOperationEntries}
            loading={vmOperationLoading}
            refreshing={vmOperationRefreshing}
            paginationResetKey={selectedRangeId ?? ""}
            onRefresh={() =>
              void queryClient.invalidateQueries({
                queryKey: queryKeys.vmOperationLog(selectedRangeId),
              })
            }
            emptyMessage={
              selectedRangeId
                ? "No VM destroys or extension removals recorded for this range"
                : "Select a range to see its VM operation history"
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
