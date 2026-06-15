"use client"

import dynamic from "next/dynamic"
import {
  ArrowLeft,
  Copy,
  Loader2,
  Puzzle,
  RefreshCw,
  Server,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TabsContent } from "@/components/ui/tabs"
import {
  CorrelatedHistoryRow,
  formatLogHistoryDuration,
  formatLogHistoryLocalRange,
} from "@/components/range/log-history-list"
import {
  aggregateDeployStatuses,
  correlateHistoryEntries,
} from "@/lib/goad-deploy-history-correlation"
import {
  formatDuration,
  formatTaskInstant,
} from "@/components/goad/goad-instance-tab-utils"
import { cn } from "@/lib/utils"
import type { GoadHistoryTabProps } from "./types"

const GoadTerminal = dynamic(
  () => import("@/components/goad/goad-terminal").then((m) => ({ default: m.GoadTerminal })),
  { ssr: false },
)

const GoadLogSplitPane = dynamic(
  () => import("@/components/goad/goad-log-split-pane").then((m) => ({ default: m.GoadLogSplitPane })),
  { ssr: false },
)

function getTaskStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="success" className="text-xs">Completed</Badge>
    case "running":
      return <Badge variant="warning" className="text-xs animate-pulse">Running</Badge>
    case "error":
      return <Badge variant="destructive" className="text-xs">Error</Badge>
    case "aborted":
      return <Badge variant="secondary" className="text-xs">Aborted</Badge>
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>
  }
}

export function GoadHistoryTab({
  active,
  instanceId,
  ludusRangeId,
  selectedHistoryEntry,
  historyDetailLoading,
  historyDeployLines,
  historyGoadLines,
  historyLoading,
  deployHistoryLoading,
  deployHistory,
  taskHistory,
  logMarkerEnrichment,
  onClearSelection,
  onFetchAllHistory,
  onSelectHistoryEntry,
  onCopyDeployLogId,
  onCopyTaskId,
}: GoadHistoryTabProps) {
  return (
    <TabsContent value="history" className="mt-4 flex flex-col min-h-0 flex-1">
      {active ? (
        <>
          {selectedHistoryEntry ? (
            <div className="flex flex-col min-h-0 flex-1">
              <div className="flex items-center gap-3 mb-3 flex-shrink-0">
                <Button size="sm" variant="ghost" onClick={onClearSelection} className="gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
              </div>
              {historyDetailLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {(selectedHistoryEntry.deployEntry || selectedHistoryEntry.goadTask) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 flex-shrink-0">
                      {selectedHistoryEntry.deployEntry &&
                        (() => {
                          const batch = selectedHistoryEntry.mergedBatchDeploys
                          const de = selectedHistoryEntry.deployEntry
                          const ludusStatus =
                            batch && batch.length > 0 ? aggregateDeployStatuses(batch) : de.status
                          const sorted =
                            batch && batch.length > 0
                              ? [...batch].sort(
                                  (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
                                )
                              : null
                          const winStart = sorted?.[0]?.start ?? de.start
                          const winEnd = sorted?.length
                            ? sorted.reduce((a, b) =>
                                new Date(a.end).getTime() >= new Date(b.end).getTime() ? a : b,
                              ).end
                            : de.end
                          const st = ludusStatus.toLowerCase()
                          const badgeVariant =
                            st === "success"
                              ? "success"
                              : st === "running" || st === "waiting"
                                ? "warning"
                                : "destructive"
                          return (
                            <Card className="border-border/80">
                              <CardHeader className="p-3 pb-2 space-y-0">
                                <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center justify-between gap-2">
                                  <span className="flex items-center gap-2 min-w-0 flex-wrap">
                                    <Server className="h-3.5 w-3.5 shrink-0" />
                                    <span>
                                      {batch && batch.length > 1
                                        ? `Ludus deploys (${batch.length})`
                                        : "Ludus deploy"}
                                    </span>
                                    <Badge variant={badgeVariant} className="text-[10px] capitalize">
                                      {ludusStatus}
                                    </Badge>
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-7 w-7 shrink-0"
                                    title="Copy first deploy log id"
                                    onClick={() => onCopyDeployLogId(de.id)}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="p-3 pt-0 text-xs space-y-1.5 text-muted-foreground">
                                {batch && batch.length > 1 ? (
                                  <div className="space-y-1">
                                    {batch.map((d) => (
                                      <p key={d.id} className="font-mono break-all">
                                        <span className="text-muted-foreground/80">Id </span>
                                        <span className="text-foreground">{d.id}</span>
                                      </p>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="font-mono break-all">
                                    <span className="text-muted-foreground/80">Id </span>
                                    <span className="text-foreground">{de.id}</span>
                                  </p>
                                )}
                                <p>
                                  <span className="text-muted-foreground/80">Window </span>
                                  {formatLogHistoryLocalRange(winStart, winEnd)}
                                  <span className="text-border mx-1">·</span>
                                  {formatLogHistoryDuration(winStart, winEnd)}
                                </p>
                                {de.template?.trim() && (
                                  <code
                                    className="block text-[11px] text-primary/90 truncate"
                                    title={de.template}
                                  >
                                    {de.template}
                                  </code>
                                )}
                              </CardContent>
                            </Card>
                          )
                        })()}
                      {selectedHistoryEntry.goadTask && (
                        <Card className="border-border/80">
                          <CardHeader className="p-3 pb-2 space-y-0">
                            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 min-w-0 flex-wrap">
                                <Puzzle className="h-3.5 w-3.5 shrink-0" />
                                <span>GOAD task</span>
                                {getTaskStatusBadge(selectedHistoryEntry.goadTask.status)}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-7 w-7 shrink-0"
                                title="Copy task id"
                                onClick={() => onCopyTaskId(selectedHistoryEntry.goadTask!.id)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 pt-0 text-xs space-y-1.5 text-muted-foreground">
                            <p className="font-mono break-all">
                              <span className="text-muted-foreground/80">Id </span>
                              <span className="text-foreground">{selectedHistoryEntry.goadTask.id}</span>
                            </p>
                            <p>
                              {formatTaskInstant(selectedHistoryEntry.goadTask.startedAt)}
                              {selectedHistoryEntry.goadTask.endedAt != null && (
                                <>
                                  <span className="text-border mx-1">→</span>
                                  {formatTaskInstant(selectedHistoryEntry.goadTask.endedAt)}
                                  <span className="text-border mx-1">·</span>
                                  {formatDuration(
                                    selectedHistoryEntry.goadTask.startedAt,
                                    selectedHistoryEntry.goadTask.endedAt,
                                  )}
                                </>
                              )}
                            </p>
                            <p>{selectedHistoryEntry.goadTask.lineCount} lines</p>
                            <code
                              className="block text-[11px] text-primary/90 break-all max-h-20 overflow-y-auto"
                              title={selectedHistoryEntry.goadTask.command}
                            >
                              {selectedHistoryEntry.goadTask.command.length > 200
                                ? `${selectedHistoryEntry.goadTask.command.slice(0, 197)}…`
                                : selectedHistoryEntry.goadTask.command}
                            </code>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                  <GoadLogSplitPane
                    className="gap-3 flex-1 min-h-0"
                    left={
                      <GoadTerminal
                        lines={historyDeployLines}
                        label={`Range Logs — ${ludusRangeId ?? "no range"}${
                          selectedHistoryEntry.deployEntry
                            ? ` · ${
                                selectedHistoryEntry.mergedBatchDeploys?.length
                                  ? aggregateDeployStatuses(selectedHistoryEntry.mergedBatchDeploys)
                                  : selectedHistoryEntry.deployEntry.status
                              }`
                            : ""
                        }`}
                        className="flex flex-col min-h-0 h-full"
                      />
                    }
                    right={
                      <GoadTerminal
                        lines={historyGoadLines}
                        label={`GOAD Logs — ${instanceId}${selectedHistoryEntry.goadTask ? ` · ${selectedHistoryEntry.goadTask.command}` : ""}`}
                        className="flex flex-col min-h-0 h-full"
                      />
                    }
                  />
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <p className="text-xs text-muted-foreground">
                  Deployment history for this instance — click an entry to view side-by-side logs.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onFetchAllHistory}
                  disabled={historyLoading || deployHistoryLoading}
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      (historyLoading || deployHistoryLoading) && "animate-spin",
                    )}
                  />
                </Button>
              </div>
              {historyLoading || deployHistoryLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (() => {
                const correlated = correlateHistoryEntries(deployHistory, taskHistory)
                if (correlated.length === 0 && taskHistory.length === 0) {
                  return (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No recorded operations for this instance yet
                    </div>
                  )
                }
                return (
                  <div className="space-y-2 overflow-y-auto flex-1">
                    {correlated.map((entry, idx) => (
                      <CorrelatedHistoryRow
                        key={
                          entry.mergedBatchDeploys && entry.mergedBatchDeploys.length > 0
                            ? `${entry.goadTask?.id ?? "goad"}-merged`
                            : entry.deployEntry?.id ?? entry.goadTask?.id ?? idx
                        }
                        row={entry}
                        selectedId={null}
                        showTemplate
                        enrichment={logMarkerEnrichment}
                        onSelectRow={(row) => void onSelectHistoryEntry(row)}
                      />
                    ))}
                  </div>
                )
              })()}
            </>
          )}
        </>
      ) : null}
    </TabsContent>
  )
}
