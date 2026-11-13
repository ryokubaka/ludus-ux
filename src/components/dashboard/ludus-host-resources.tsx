"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Cpu, Loader2, MemoryStick, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useEffectiveScopeTag } from "@/lib/session/effective-scope-context"
import { queryKeys } from "@/lib/ui/query-keys"
import { consolidateNodeResources } from "@/lib/proxmox/proxmox-node-metrics-parse"
import {
  describeHostResourcesView,
  type HostResourcesPayload,
  type HostResourcesViewMeta,
} from "@/lib/proxmox/host-resources"
import { cn } from "@/lib/core/utils"

const POLL_MS = 10_000

function formatGiB(bytes: number): string {
  const gib = bytes / 1024 ** 3
  return gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)
}

function meterClass(pct: number | null): string {
  if (pct == null) return "bg-muted"
  if (pct >= 90) return "bg-status-error"
  if (pct >= 75) return "bg-status-warning"
  return "bg-status-success"
}

function Meter(props: {
  label: string
  icon: ReactNode
  pct: number | null
  detail: string
}) {
  const width = props.pct == null ? 0 : Math.max(0, Math.min(100, props.pct))
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {props.icon}
          {props.label}
        </span>
        <span className="font-mono text-foreground">{props.pct == null ? "—" : `${props.pct.toFixed(0)}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
        <div className={cn("h-full rounded-full transition-all", meterClass(props.pct))} style={{ width: `${width}%` }} />
      </div>
      <p className="text-[11px] text-muted-foreground truncate">{props.detail}</p>
    </div>
  )
}

function verifiedTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function StatusLine(props: {
  view: HostResourcesViewMeta
  fetching: boolean
  onRetry: () => void
}) {
  const time = props.view.lastVerifiedAt != null ? verifiedTime(props.view.lastVerifiedAt) : null

  if (props.view.state === "refreshing") {
    return (
      <div
        className="flex min-w-0 items-center gap-1 text-[11px] text-status-warning"
        title={props.view.lastError ?? undefined}
      >
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        <span className="truncate">Refreshing{time ? ` — verified ${time}` : ""}</span>
      </div>
    )
  }

  if (props.view.state === "fresh") {
    return (
      <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" title="Verified host metrics">
        <span className="truncate">{time ? `Updated ${time}` : "Verified"}</span>
      </div>
    )
  }

  if (props.view.state === "stale") {
    return (
      <div
        className="flex min-w-0 items-center gap-1 text-[11px] text-status-warning"
        title={props.view.lastError ?? undefined}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {props.view.lastError ? "Refresh failed" : "Last verified"}
          {time ? ` — ${time}` : ""}
        </span>
      </div>
    )
  }

  return (
    <div
      className="flex min-w-0 items-center gap-1 text-[11px] text-status-error"
      title={props.view.lastError ?? undefined}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span className="truncate">Unavailable{time ? ` — verified ${time}` : ""}</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 px-1 text-[11px]"
        onClick={props.onRetry}
        disabled={props.fetching}
      >
        Retry
      </Button>
    </div>
  )
}

export function LudusHostResources({
  initialHostResources = false,
}: {
  /**
   * True when SSR prefetched a host snapshot. The server rendered its values,
   * so hydration must render them too; otherwise a restored localStorage
   * snapshot would change the markup mid-hydration.
   */
  initialHostResources?: boolean
} = {}) {
  const scopeTag = useEffectiveScopeTag()
  /** Null until mounted so SSR and hydration render the same deterministic text. */
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const id = window.setInterval(tick, 5_000)
    return () => window.clearInterval(id)
  }, [])

  const { data, isFetching, error, refetch } = useQuery<HostResourcesPayload>({
    queryKey: queryKeys.hostResources(scopeTag),
    queryFn: async () => {
      const res = await fetch("/api/host-resources", { cache: "no-store" })
      const body = (await res.json().catch(() => null)) as
        | (Partial<HostResourcesPayload> & { error?: string })
        | null
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `Host metrics request failed (HTTP ${res.status})`,
        )
      }
      if (!body || !Array.isArray(body.nodes) || typeof body.capturedAt !== "number") {
        throw new Error("Host metrics response was invalid")
      }
      return {
        capturedAt: body.capturedAt,
        nodes: body.nodes,
        refreshing: body.refreshing === true,
        ...(typeof body.error === "string" && body.error ? { error: body.error } : {}),
      }
    },
    // Always revalidate on mount: a restored snapshot may be hours old, and the
    // card labels it with its capturedAt timestamp while the refresh runs.
    staleTime: 0,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  })

  const payload = data ?? null
  const nodes = payload?.nodes ?? []
  /** Hold restored-but-not-SSR data until after mount to keep hydration stable. */
  const showSnapshot = now != null || initialHostResources
  const hasData = showSnapshot && nodes.length > 0
  const view: HostResourcesViewMeta = showSnapshot
    ? describeHostResourcesView({
        hasData,
        capturedAt: payload?.capturedAt ?? null,
        // Before mount, use capturedAt so the pre-hydration render is deterministic.
        now: now ?? payload?.capturedAt ?? 0,
        fetching: isFetching,
        refreshing: payload?.refreshing === true,
        error: error ?? payload?.error ?? null,
      })
    : { state: "loading", lastVerifiedAt: null, ageMs: null, lastError: null }

  const cluster = hasData ? consolidateNodeResources(nodes) : null
  const memDetail =
    cluster?.memBytes != null && cluster.maxMemBytes != null
      ? `${formatGiB(cluster.memBytes)} / ${formatGiB(cluster.maxMemBytes)} GiB`
      : "—"
  const title = !showSnapshot
    ? "Ludus host"
    : cluster && cluster.nodeCount > 1
      ? `Ludus cluster · ${cluster.nodeCount} nodes`
      : `Ludus host${nodes.length === 1 ? ` · ${nodes[0].name}` : ""}`

  const retry = () => void refetch()

  return (
    <Card className="glass-card">
      <CardContent className="space-y-2 p-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{title}</span>
          {hasData && now != null && (
            <StatusLine view={view} fetching={isFetching} onRetry={retry} />
          )}
        </div>
        {!hasData && view.state === "loading" && (
          <p className="text-xs text-muted-foreground">Reading CPU and memory…</p>
        )}
        {!hasData && view.state === "unavailable" && (
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-status-error" title={view.lastError ?? undefined}>
              {view.lastError ?? "Host metrics unavailable"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1 text-[11px]"
              onClick={retry}
              disabled={isFetching}
            >
              {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Retry
            </Button>
          </div>
        )}
        {cluster && (
          <div className={cn("grid grid-cols-2 gap-4", view.state === "unavailable" && "opacity-60")}>
            <Meter
              label="CPU"
              icon={<Cpu className="h-3.5 w-3.5" />}
              pct={cluster.cpuPct}
              detail={cluster.nodeCount > 1 ? "Across the cluster" : "Host CPU"}
            />
            <Meter label="Memory" icon={<MemoryStick className="h-3.5 w-3.5" />} pct={cluster.memPct} detail={memDetail} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
