"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RefreshCw, Clock, Loader2, ScrollText, Puzzle, Server, ChevronLeft, ChevronRight } from "lucide-react"
import { cn, timeAgo } from "@/lib/utils"
import type { LogHistoryEntry } from "@/lib/types"
import {
  type CorrelatedHistoryEntry,
  type GoadTaskForCorrelation,
  findCorrelatedGoadTask,
  correlateHistoryEntries,
  goadIntegratedRowTitle,
  integratedHistoryBadge,
} from "@/lib/goad-deploy-history-correlation"

function statusVariant(status: string) {
  switch (status.toLowerCase()) {
    case "success":
      return "success" as const
    case "error":
    case "aborted":
      return "destructive" as const
    case "running":
      return "warning" as const
    default:
      return "secondary" as const
  }
}

/** Map a GOAD task's status to the same badge palette used for Ludus deploys. */
function goadTaskStatusBadge(task: GoadTaskForCorrelation): { variant: "success" | "warning" | "destructive" | "secondary"; label: string } {
  const s = (task.status || "").toLowerCase()
  if (s === "running") return { variant: "warning", label: "Running" }
  if (s === "aborted" || s === "cancelled" || s === "canceled") return { variant: "secondary", label: "Aborted" }
  if (s === "failed" || s === "error" || s === "failure") return { variant: "destructive", label: "Failed" }
  if (s === "completed" || s === "done" || s === "success") {
    if (typeof task.exitCode === "number" && task.exitCode !== 0) {
      return { variant: "destructive", label: "Failed" }
    }
    return { variant: "success", label: "Done" }
  }
  return { variant: "secondary", label: task.status || "Unknown" }
}

function formatGoadTaskDurationMs(startedAt: number, endedAt?: number): string {
  const end = endedAt ?? Date.now()
  const sec = Math.max(0, Math.floor((end - startedAt) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m ${sec % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function formatLogHistoryDuration(start: string, end: string): string {
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (!s || !e || e <= s) return "—"
  const sec = Math.floor((e - s) / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m ${sec % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Compact local wall-clock for scanability in history rows */
export function formatLogHistoryLocalRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  if (Number.isNaN(s.getTime())) return "—"
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }
  const left = s.toLocaleString(undefined, opts)
  if (Number.isNaN(e.getTime()) || e.getTime() <= s.getTime()) return left
  return `${left} → ${e.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
}

interface LogHistoryListProps {
  entries: LogHistoryEntry[]
  loading: boolean
  onSelect: (id: string) => void
  selectedId: string | null
  onRefresh?: () => void
  refreshing?: boolean
  /** When set, rows may open GOAD instance Logs History if a GOAD task correlates with that deploy. */
  goadInstanceId?: string | null
  /**
   * Tasks for this GOAD workspace instance (same filter as goad/[id] history).
   * When `goadInstanceId` is set: `undefined` = still loading (no GOAD badge); array = use correlation.
   */
  goadTasks?: GoadTaskForCorrelation[] | null
  /** When set, show this count in the list header instead of `entries.length` (pagination). */
  totalEntryCount?: number
  /** When true, show the `template` field if Ludus populated it (deploy tags / template name). */
  showTemplate?: boolean
  emptyMessage?: string
}

export function LogHistoryList({
  entries,
  loading,
  onSelect,
  selectedId,
  onRefresh,
  refreshing,
  goadInstanceId,
  goadTasks,
  totalEntryCount,
  showTemplate,
  emptyMessage = "No log history yet",
}: LogHistoryListProps) {
  const router = useRouter()
  const headerTotal = totalEntryCount ?? entries.length

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
            {headerTotal} {headerTotal === 1 ? "entry" : "entries"}
          </p>
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm flex flex-col items-center gap-2">
          <ScrollText className="h-6 w-6 opacity-40" />
          {emptyMessage}
        </div>
      ) : (
        entries.map((entry) => {
          const tasksList = goadTasks ?? null
          const linked =
            !!goadInstanceId &&
            tasksList != null &&
            !!findCorrelatedGoadTask(entry, tasksList)
          return (
          <Card
            key={entry.id}
            className={cn(
              "cursor-pointer transition-colors",
              selectedId === entry.id
                ? "border-primary bg-primary/5"
                : "hover:border-primary/50",
            )}
            onClick={() => {
              if (linked && goadInstanceId) {
                router.push(
                  `/goad/${encodeURIComponent(goadInstanceId)}?tab=history&deployLogId=${encodeURIComponent(entry.id)}`,
                )
              } else {
                onSelect(entry.id)
              }
            }}
          >
            <CardContent className="p-3 flex items-start gap-3">
              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  {linked && (
                    <Badge
                      variant="outline"
                      className="text-[10px] gap-0.5 px-1 py-0 border-primary/40 text-primary"
                    >
                      <Puzzle className="h-2.5 w-2.5" />
                      GOAD
                    </Badge>
                  )}
                  <span>{timeAgo(entry.start)}</span>
                  <span className="text-border">·</span>
                  <span>{formatLogHistoryDuration(entry.start, entry.end)}</span>
                  <span className="text-border">·</span>
                  <code
                    className="font-mono text-[10px] text-muted-foreground/90 break-all"
                    title={entry.id}
                  >
                    {entry.id}
                  </code>
                </div>
                <p className="text-[11px] text-muted-foreground/90 leading-snug">
                  {formatLogHistoryLocalRange(entry.start, entry.end)}
                </p>
                {showTemplate !== false && entry.template?.trim() && (
                  <code className="font-mono text-[11px] text-primary/90 truncate block" title={entry.template}>
                    {entry.template}
                  </code>
                )}
              </div>
              <Badge variant={statusVariant(entry.status)} className="text-xs capitalize flex-shrink-0">
                {entry.status}
              </Badge>
            </CardContent>
          </Card>
        )})
      )}
    </div>
  )
}

export const DEPLOY_HISTORY_PAGE_SIZE = 5

type PaginatedLogHistoryListProps = Omit<LogHistoryListProps, "entries"> & {
  /** Full list from Ludus; only a page slice is passed to the inner list. */
  allEntries: LogHistoryEntry[]
  /** When this value changes (e.g. selected range id), reset to page 1. */
  paginationResetKey?: string
}

/** `Xh Ym Zs` from ms with `0s` floor. */
function formatMsDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m ${sec % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * Deploy-vs-provision breakdown for a goad_integrated row.
 * `provisionMs` starts when the Ludus deploy *ends* (or task start, whichever
 * is later) so we don't double-count the overlap Ansible spends inside Ludus.
 */
function splitIntegratedDuration(
  deploy: LogHistoryEntry,
  task: GoadTaskForCorrelation,
): { deployMs: number; provisionMs: number; totalMs: number } {
  const dStart = new Date(deploy.start).getTime() || 0
  const dEndRaw = new Date(deploy.end).getTime()
  const dEnd = dEndRaw || Date.now()
  const tEnd = task.endedAt ?? Date.now()
  const deployMs = Math.max(0, dEnd - dStart)
  const provisionStart = Math.max(dEnd, task.startedAt)
  const provisionMs = Math.max(0, tEnd - provisionStart)
  const totalMs = Math.max(0, tEnd - Math.min(dStart || task.startedAt, task.startedAt))
  return { deployMs, provisionMs, totalMs }
}

/** Multi-Ludus-deploy span + one GOAD task (single Ansible run). */
function splitIntegratedDurationMerged(
  deploys: LogHistoryEntry[],
  task: GoadTaskForCorrelation,
): { deployMs: number; provisionMs: number; totalMs: number } {
  const starts = deploys.map((d) => new Date(d.start).getTime() || 0)
  const ends = deploys.map((d) => {
    const e = new Date(d.end).getTime()
    return e || Date.now()
  })
  const firstStart = Math.min(...starts)
  const lastDeployEnd = Math.max(...ends)
  const deployMs = Math.max(0, lastDeployEnd - firstStart)
  const provisionStart = Math.max(lastDeployEnd, task.startedAt)
  const tEnd = task.endedAt ?? Date.now()
  const provisionMs = Math.max(0, tEnd - provisionStart)
  const totalMs = Math.max(0, tEnd - Math.min(firstStart, task.startedAt))
  return { deployMs, provisionMs, totalMs }
}

/**
 * Slices deploy history to `DEPLOY_HISTORY_PAGE_SIZE` rows with prev/next (Dashboard / Range Logs).
 *
 * When `goadInstanceId + goadTasks` are provided the rows are rendered from the
 * correlation output (`goad_integrated | goad_only | ludus_only`) so the list
 * matches the GOAD instance page format 1:1 (GOAD badge, action title,
 * combined deploy + provision duration, line count, `Ludus + GOAD` marker).
 * Without a GOAD context we fall back to the original `LogHistoryList` for
 * template-page parity.
 */
export function PaginatedLogHistoryList({
  allEntries,
  paginationResetKey = "",
  ...rest
}: PaginatedLogHistoryListProps) {
  const [page, setPage] = useState(0)
  const {
    goadInstanceId,
    goadTasks,
    selectedId,
    onRefresh,
    refreshing,
    onSelect,
    emptyMessage,
    loading,
    showTemplate,
  } = rest
  const router = useRouter()

  // Parent passes `undefined` while GOAD tasks are loading — must not fall back to
  // plain LogHistoryList or rows lose action titles / durations (Dashboard issue).
  const waitingForGoadCorrelation = !!goadInstanceId && goadTasks === undefined
  const hasGoadContext = !!goadInstanceId && Array.isArray(goadTasks)

  // Build the row list. Without GOAD context we hand off to LogHistoryList below,
  // so this is only used in the correlated path.
  const rows: CorrelatedHistoryEntry[] = useMemo(() => {
    if (!hasGoadContext) return []
    return correlateHistoryEntries(allEntries, goadTasks ?? [])
  }, [allEntries, goadTasks, hasGoadContext])

  const total = hasGoadContext ? rows.length : allEntries.length
  const pageCount = Math.max(1, Math.ceil(total / DEPLOY_HISTORY_PAGE_SIZE))

  useEffect(() => {
    setPage(0)
  }, [paginationResetKey])

  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * DEPLOY_HISTORY_PAGE_SIZE
  const end = start + DEPLOY_HISTORY_PAGE_SIZE

  if (waitingForGoadCorrelation) {
    return (
      <div className="space-y-2">
        {onRefresh && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Loading GOAD task metadata…</p>
            <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </Button>
          </div>
        )}
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  // Non-GOAD path: delegate a paged slice to LogHistoryList (templates page).
  if (!hasGoadContext) {
    const slice = allEntries.slice(start, end)
    return (
      <div className="space-y-2">
        <LogHistoryList
          {...rest}
          entries={slice}
          totalEntryCount={total}
        />
        {total > DEPLOY_HISTORY_PAGE_SIZE && (
          <PaginationFooter
            safePage={safePage}
            pageCount={pageCount}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          />
        )}
      </div>
    )
  }

  if (loading && allEntries.length === 0) {
    return (
      <div className="space-y-2">
        {onRefresh && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Loading deploy history…</p>
            <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </Button>
          </div>
        )}
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const slice = rows.slice(start, end)

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

      {slice.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm flex flex-col items-center gap-2">
          <ScrollText className="h-6 w-6 opacity-40" />
          {emptyMessage ?? "No log history yet"}
        </div>
      ) : (
        <div className="space-y-2">
          {slice.map((row, idx) => (
            <CorrelatedHistoryRow
              key={
                row.mergedBatchDeploys && row.mergedBatchDeploys.length > 0
                  ? `${row.goadTask?.id ?? "goad"}-merged`
                  : row.deployEntry?.id ?? row.goadTask?.id ?? idx
              }
              row={row}
              selectedId={selectedId}
              showTemplate={showTemplate}
              onSelectDeploy={(id) => {
                if (row.goadTask && goadInstanceId) {
                  router.push(
                    `/goad/${encodeURIComponent(goadInstanceId)}?tab=history&deployLogId=${encodeURIComponent(id)}`,
                  )
                } else {
                  onSelect(id)
                }
              }}
              onSelectGoadOnly={() => {
                if (goadInstanceId) {
                  router.push(`/goad/${encodeURIComponent(goadInstanceId)}?tab=history`)
                }
              }}
            />
          ))}
        </div>
      )}

      {total > DEPLOY_HISTORY_PAGE_SIZE && (
        <PaginationFooter
          safePage={safePage}
          pageCount={pageCount}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        />
      )}
    </div>
  )
}

function PaginationFooter({
  safePage,
  pageCount,
  onPrev,
  onNext,
}: {
  safePage: number
  pageCount: number
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8"
        disabled={safePage <= 0}
        onClick={onPrev}
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
        onClick={onNext}
      >
        Next
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

/**
 * A single correlated history row — handles all three kinds (`goad_integrated`,
 * `goad_only`, `ludus_only`) in one component so dashboard + range-logs +
 * (future) instance-page share identical visuals.
 */
export function CorrelatedHistoryRow({
  row,
  selectedId,
  showTemplate,
  onSelectDeploy,
  onSelectGoadOnly,
  /** When set (e.g. GOAD instance page), receives the full row — preferred over deploy/goad callbacks. */
  onSelectRow,
}: {
  row: CorrelatedHistoryEntry
  selectedId: string | null
  showTemplate?: boolean
  onSelectDeploy?: (deployId: string) => void
  onSelectGoadOnly?: () => void
  onSelectRow?: (row: CorrelatedHistoryEntry) => void
}) {
  const deploy = row.deployEntry
  const task = row.goadTask
  const batch = row.mergedBatchDeploys
  const deploysForMetrics =
    batch && batch.length > 0 ? batch : deploy ? [deploy] : []

  const selectedKey = deploy?.id ?? task?.id ?? ""
  const isSelected =
    !!selectedId &&
    (selectedId === selectedKey || (batch?.some((d) => d.id === selectedId) ?? false))

  const handleClick = () => {
    if (onSelectRow) {
      onSelectRow(row)
      return
    }
    if (deploy) onSelectDeploy?.(deploy.id)
    else onSelectGoadOnly?.()
  }

  // Status badge — integrated uses combined status so the row reflects the worst
  // of Ludus + GOAD; ludus_only uses the raw deploy status; goad_only uses the
  // task status (via goadTaskStatusBadge).
  let statusNode: React.ReactNode = null
  if (row.kind === "goad_integrated") {
    const ib = integratedHistoryBadge(row)
    statusNode = (
      <Badge variant={ib.variant} className="text-xs capitalize flex-shrink-0">
        {ib.label}
      </Badge>
    )
  } else if (row.kind === "ludus_only" && deploy) {
    statusNode = (
      <Badge variant={statusVariant(deploy.status)} className="text-xs capitalize flex-shrink-0">
        {deploy.status}
      </Badge>
    )
  } else if (row.kind === "goad_only" && task) {
    const sb = goadTaskStatusBadge(task)
    statusNode = (
      <Badge variant={sb.variant} className="text-xs capitalize flex-shrink-0">
        {sb.label}
      </Badge>
    )
  }

  const earliestStart =
    deploysForMetrics.length > 0
      ? deploysForMetrics.reduce((a, b) =>
          new Date(a.start).getTime() <= new Date(b.start).getTime() ? a : b,
        ).start
      : deploy?.start

  const startedAtLabel = earliestStart
    ? timeAgo(earliestStart)
    : task
      ? timeAgo(task.startedAt)
      : ""

  let durationLabel: string | null = null
  if (row.kind === "goad_integrated" && task && deploysForMetrics.length > 0) {
    const { deployMs, provisionMs, totalMs } =
      batch && batch.length > 1
        ? splitIntegratedDurationMerged(batch, task)
        : deploy
          ? splitIntegratedDuration(deploy, task)
          : splitIntegratedDurationMerged(deploysForMetrics, task)
    const parts: string[] = []
    if (deployMs > 0) parts.push(`${formatMsDuration(deployMs)} deploy`)
    if (provisionMs > 0) parts.push(`${formatMsDuration(provisionMs)} provision`)
    if (totalMs > 0 && parts.length > 1) parts.push(`${formatMsDuration(totalMs)} total`)
    durationLabel = parts.join(" · ") || formatMsDuration(totalMs)
  } else if (row.kind === "ludus_only" && deploy) {
    durationLabel = formatLogHistoryDuration(deploy.start, deploy.end)
  } else if (row.kind === "goad_only" && task) {
    durationLabel = formatGoadTaskDurationMs(task.startedAt, task.endedAt)
  }

  const lineCount = task?.lineCount

  const localRange = (() => {
    if (deploysForMetrics.length > 0) {
      const first = deploysForMetrics.reduce((a, b) =>
        new Date(a.start).getTime() <= new Date(b.start).getTime() ? a : b,
      )
      const lastEnd = deploysForMetrics.reduce((a, b) =>
        new Date(a.end).getTime() >= new Date(b.end).getTime() ? a : b,
      )
      const lastEndMs = new Date(lastEnd.end).getTime() || 0
      const endIso = task?.endedAt
        ? new Date(Math.max(task.endedAt, lastEndMs)).toISOString()
        : lastEnd.end
      return formatLogHistoryLocalRange(first.start, endIso)
    }
    if (deploy) {
      return formatLogHistoryLocalRange(
        deploy.start,
        task?.endedAt
          ? new Date(Math.max(task.endedAt, new Date(deploy.end).getTime() || 0)).toISOString()
          : deploy.end,
      )
    }
    if (task) {
      return formatLogHistoryLocalRange(
        new Date(task.startedAt).toISOString(),
        task.endedAt ? new Date(task.endedAt).toISOString() : new Date(task.startedAt).toISOString(),
      )
    }
    return ""
  })()

  return (
    <Card
      className={cn(
        "cursor-pointer transition-colors",
        isSelected ? "border-primary bg-primary/5" : "hover:border-primary/50",
      )}
      onClick={handleClick}
    >
      <CardContent className="p-3 flex items-start gap-3">
        <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          {/* Badges + title */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {(row.kind === "ludus_only" || row.kind === "goad_integrated") && deploy && (
              <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0">
                <Server className="h-2.5 w-2.5" />
                Range Deploy
              </Badge>
            )}
            {task && (
              <>
                <Badge
                  variant="outline"
                  className="text-[10px] gap-0.5 px-1 py-0 border-primary/40 text-primary"
                >
                  <Puzzle className="h-2.5 w-2.5" />
                  GOAD
                </Badge>
                <span className="text-sm font-medium text-foreground truncate max-w-[min(100%,28rem)]">
                  {goadIntegratedRowTitle(row)}
                </span>
              </>
            )}
          </div>

          {/* Meta line 1: time ago · duration · lines · Ludus+GOAD */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {startedAtLabel && <span>{startedAtLabel}</span>}
            {durationLabel && (
              <>
                <span className="text-border">·</span>
                <span>{durationLabel}</span>
              </>
            )}
            {typeof lineCount === "number" && (
              <>
                <span className="text-border">·</span>
                <span>{lineCount} lines</span>
              </>
            )}
            {row.kind === "goad_integrated" && (
              <>
                <span className="text-border">·</span>
                <span>Ludus + GOAD</span>
              </>
            )}
          </div>

          {batch && batch.length > 1 ? (
            <div className="space-y-0.5">
              {batch.map((d) => (
                <code
                  key={d.id}
                  className="font-mono text-[10px] text-muted-foreground/90 break-all block"
                  title={d.id}
                >
                  {d.id}
                </code>
              ))}
            </div>
          ) : (
            deploy && (
              <code
                className="font-mono text-[10px] text-muted-foreground/90 break-all block"
                title={deploy.id}
              >
                {deploy.id}
              </code>
            )
          )}

          {/* Local wall-clock window */}
          {localRange && (
            <p className="text-[11px] text-muted-foreground/90 leading-snug">{localRange}</p>
          )}

          {/* Template tag (only when caller opted in and Ludus set it) */}
          {showTemplate !== false && deploy?.template?.trim() && (
            <code
              className="font-mono text-[11px] text-primary/90 truncate block"
              title={deploy.template}
            >
              {deploy.template}
            </code>
          )}
        </div>
        {statusNode}
      </CardContent>
    </Card>
  )
}
