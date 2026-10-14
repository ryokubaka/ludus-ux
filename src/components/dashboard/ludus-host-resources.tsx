"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Cpu, MemoryStick } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { consolidateNodeResources } from "@/lib/proxmox-node-metrics-parse"
import { cn } from "@/lib/utils"

const POLL_MS = 10_000

type NodeSample = {
  name: string
  cpuPct: number | null
  memPct: number | null
  memBytes: number | null
  maxMemBytes: number | null
  maxCpu: number | null
}

type ApiOk = { capturedAt: number; nodes: NodeSample[] }

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

export function LudusHostResources() {
  const [nodes, setNodes] = useState<NodeSample[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (document.visibilityState === "hidden") return
      try {
        const res = await fetch("/api/host-resources", { cache: "no-store" })
        const data = (await res.json().catch(() => null)) as ({ error?: string } & Partial<ApiOk>) | null
        if (cancelled) return
        if (!res.ok) {
          setError(typeof data?.error === "string" ? data.error : "Host metrics unavailable")
          return
        }
        setError(null)
        setNodes(data?.nodes ?? [])
      } catch {
        if (!cancelled) setError("Host metrics unavailable")
      }
    }
    void load()
    const id = window.setInterval(() => void load(), POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const cluster = nodes && nodes.length > 0 ? consolidateNodeResources(nodes) : null
  const memDetail =
    cluster?.memBytes != null && cluster.maxMemBytes != null
      ? `${formatGiB(cluster.memBytes)} / ${formatGiB(cluster.maxMemBytes)} GiB`
      : "—"
  const title =
    cluster && cluster.nodeCount > 1
      ? `Ludus cluster · ${cluster.nodeCount} nodes`
      : `Ludus host${nodes?.length === 1 ? ` · ${nodes[0].name}` : ""}`

  return (
    <Card className="glass-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{title}</span>
          {error && nodes == null && <span className="text-[11px] text-muted-foreground">{error}</span>}
        </div>
        {nodes == null && !error && <p className="text-xs text-muted-foreground">Reading CPU and memory…</p>}
        {cluster && (
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
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
