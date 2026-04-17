"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  RefreshCw,
  Loader2,
  Trash2,
  Puzzle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { VmOperationLogEntry } from "@/lib/api"
import { timeAgo } from "@/lib/utils"

function kindLabel(kind: VmOperationLogEntry["kind"]): string {
  return kind === "destroy_vm" ? "Destroy VM" : "Remove extension"
}

function kindIcon(kind: VmOperationLogEntry["kind"]) {
  return kind === "destroy_vm" ? Trash2 : Puzzle
}

function statusLabel(s: "ok" | "error"): string {
  return s === "ok" ? "Success" : "Error"
}

export const VM_OPERATION_PAGE_SIZE = 5

interface VmOperationLogListProps {
  entries: VmOperationLogEntry[]
  loading: boolean
  onRefresh?: () => void
  refreshing?: boolean
  /** When this value changes (e.g. selected range id), reset to page 1. */
  paginationResetKey?: string
  emptyMessage?: string
  /** When true, show the `username` column (admin view on the Range Logs page). */
  showUsername?: boolean
}

/**
 * Renders the LUX-local VM operation audit log (destroy_vm / remove_extension).
 * Purely read-only; write path is `postVmOperationAudit()` from VM destroy and
 * extension removal flows.
 */
export function VmOperationLogList({
  entries,
  loading,
  onRefresh,
  refreshing,
  paginationResetKey = "",
  emptyMessage = "No VM operations yet",
  showUsername = false,
}: VmOperationLogListProps) {
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [paginationResetKey])

  const total = entries.length
  const pageCount = Math.max(1, Math.ceil(total / VM_OPERATION_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * VM_OPERATION_PAGE_SIZE
  const slice = entries.slice(start, start + VM_OPERATION_PAGE_SIZE)

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {onRefresh && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? "entry" : "entries"}
          </p>
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
      )}

      {total === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm flex flex-col items-center gap-2">
          <Trash2 className="h-6 w-6 opacity-40" />
          {emptyMessage}
        </div>
      ) : (
        slice.map((entry) => {
          const Icon = kindIcon(entry.kind)
          const StatusIcon = entry.status === "ok" ? CheckCircle2 : AlertTriangle
          const ts = new Date(entry.ts).toISOString()
          return (
            <Card key={entry.id} className="border-border/70">
              <CardContent className="p-3 flex items-start gap-3">
                <Icon
                  className={cn(
                    "h-4 w-4 flex-shrink-0 mt-0.5",
                    entry.kind === "destroy_vm" ? "text-red-400/80" : "text-amber-400/80",
                  )}
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-medium text-foreground">{kindLabel(entry.kind)}</span>
                    {entry.vmName && (
                      <>
                        <span className="text-border">·</span>
                        <code className="font-mono text-[11px] text-primary/90 break-all">
                          {entry.vmName}
                        </code>
                      </>
                    )}
                    {entry.vmId != null && (
                      <>
                        <span className="text-border">·</span>
                        <span className="text-muted-foreground">VMID {entry.vmId}</span>
                      </>
                    )}
                    {entry.extensionName && (
                      <>
                        <span className="text-border">·</span>
                        <span className="text-muted-foreground">
                          ext: <code className="font-mono text-[11px]">{entry.extensionName}</code>
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground/90">
                    <span title={ts}>{timeAgo(ts)}</span>
                    {showUsername && (
                      <>
                        <span className="text-border">·</span>
                        <span>by <span className="font-medium text-foreground/90">{entry.username}</span></span>
                      </>
                    )}
                    {entry.rangeId && (
                      <>
                        <span className="text-border">·</span>
                        <code className="font-mono">{entry.rangeId}</code>
                      </>
                    )}
                    {entry.instanceId && (
                      <>
                        <span className="text-border">·</span>
                        <span>GOAD: <code className="font-mono">{entry.instanceId}</code></span>
                      </>
                    )}
                  </div>
                  {entry.detail && (
                    <p
                      className="text-[11px] text-muted-foreground leading-snug break-words"
                      title={entry.detail}
                    >
                      {entry.detail}
                    </p>
                  )}
                </div>
                <Badge
                  variant={entry.status === "ok" ? "success" : "destructive"}
                  className="text-xs flex-shrink-0 gap-1"
                >
                  <StatusIcon className="h-3 w-3" />
                  {statusLabel(entry.status)}
                </Badge>
              </CardContent>
            </Card>
          )
        })
      )}

      {total > VM_OPERATION_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </Button>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            Page {safePage + 1} of {pageCount}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
