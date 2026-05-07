"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Activity, Loader2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const POLL_MS = 4000
const MAX_POINTS = 90

type MetricRow = Record<string, number | string | undefined> & { time: number; timeLabel: string }

type ApiNode = {
  name: string
  cpuPct: number | null
  memPct: number | null
  load1: number | null
  error?: string
}

type ApiOk = { capturedAt: number; nodes: ApiNode[] }

const PALETTE = [
  "hsl(199, 89%, 55%)",
  "hsl(142, 65%, 48%)",
  "hsl(280, 60%, 62%)",
  "hsl(38, 90%, 55%)",
  "hsl(340, 72%, 58%)",
]

/** Recharts defaults to a white tooltip; align with app shadcn tokens. */
const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "calc(var(--radius) - 2px)",
    fontSize: 11,
    color: "hsl(var(--card-foreground))",
    boxShadow: "0 4px 16px rgb(0 0 0 / 0.45)",
  },
  labelStyle: {
    color: "hsl(var(--muted-foreground))",
    fontWeight: 500,
    marginBottom: 4,
  },
  itemStyle: { color: "hsl(var(--foreground))" },
  wrapperStyle: { outline: "none" },
  cursor: { stroke: "hsl(var(--border))", strokeWidth: 1 },
} as const

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function LudusPerformanceTab() {
  const [rows, setRows] = useState<MetricRow[]>([])
  const [nodeNames, setNodeNames] = useState<string[]>([])
  const [lastNodes, setLastNodes] = useState<ApiNode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  const fetchOnce = useCallback(async () => {
    const res = await fetch("/api/settings/proxmox-node-metrics", { cache: "no-store" })
    const data = (await res.json().catch(() => null)) as { error?: string } & Partial<ApiOk> | null
    if (!mounted.current) return
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : res.statusText)
      setLoading(false)
      return
    }
    setError(null)
    const nodes = data?.nodes ?? []
    setLastNodes(nodes)
    const names = nodes.map((n) => n.name).filter(Boolean)
    setNodeNames((prev) => {
      if (prev.length === names.length && prev.every((p, i) => p === names[i])) return prev
      return names
    })
    const capturedAt = typeof data?.capturedAt === "number" ? data.capturedAt : Date.now()
    const row: MetricRow = {
      time: capturedAt,
      timeLabel: formatTime(capturedAt),
    }
    for (const n of nodes) {
      const key = n.name.replace(/[^a-zA-Z0-9_]/g, "_")
      if (n.cpuPct != null) row[`cpu_${key}`] = n.cpuPct
      if (n.memPct != null) row[`mem_${key}`] = n.memPct
      if (n.load1 != null) row[`load_${key}`] = n.load1
    }
    setRows((prev) => [...prev, row].slice(-MAX_POINTS))
    setLoading(false)
  }, [])

  useEffect(() => {
    mounted.current = true
    void fetchOnce()
    const id = window.setInterval(() => void fetchOnce(), POLL_MS)
    return () => {
      mounted.current = false
      window.clearInterval(id)
    }
  }, [fetchOnce])

  const chartMargins = useMemo(() => ({ top: 8, right: 12, left: 0, bottom: 0 }), [])

  const anyData = rows.length > 0 && nodeNames.length > 0

  return (
    <div className="space-y-4 mt-0">
      <Alert>
        <Activity className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Samples Proxmox every {POLL_MS / 1000}s via <code className="text-primary">pvesh</code> over root SSH. Same credentials as
          SSH &amp; GOAD. Shows all nodes in the cluster returned by <code className="text-primary">pvesh get /nodes</code>.
        </AlertDescription>
      </Alert>

      {loading && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading node metrics…
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {lastNodes.some((n) => n.error) && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            Partial errors:{" "}
            {lastNodes
              .filter((n) => n.error)
              .map((n) => `${n.name}: ${n.error}`)
              .join(" · ")}
          </AlertDescription>
        </Alert>
      )}

      {anyData && (
        <div className="grid gap-4 md:grid-cols-1">
          <ChartCard title="CPU" description="Host CPU usage (%)" rows={rows} nodeNames={nodeNames} fieldPrefix="cpu" unit="%" domain={[0, 100]} chartMargins={chartMargins} />
          <ChartCard title="Memory" description="RAM used (%)" rows={rows} nodeNames={nodeNames} fieldPrefix="mem" unit="%" domain={[0, 100]} chartMargins={chartMargins} />
          <ChartCard title="Load (1m)" description="One-minute load average" rows={rows} nodeNames={nodeNames} fieldPrefix="load" unit="" domain={[0, "auto"]} chartMargins={chartMargins} />
        </div>
      )}

      {!loading && !error && !anyData && (
        <p className="text-sm text-muted-foreground">No metric samples yet.</p>
      )}
    </div>
  )
}

function ChartCard(props: {
  title: string
  description: string
  rows: MetricRow[]
  nodeNames: string[]
  fieldPrefix: "cpu" | "mem" | "load"
  unit: string
  domain: [number, number | "auto"]
  chartMargins: { top: number; right: number; left: number; bottom: number }
}) {
  const { title, description, rows, nodeNames, fieldPrefix, unit, domain, chartMargins } = props

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="h-[220px] pt-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={chartMargins}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
            <XAxis dataKey="timeLabel" tick={{ fontSize: 10 }} className="text-muted-foreground" interval="preserveStartEnd" minTickGap={24} />
            <YAxis domain={domain} tick={{ fontSize: 10 }} width={36} className="text-muted-foreground" tickFormatter={(v) => (unit ? `${v}${unit}` : String(v))} />
            <Tooltip
              {...CHART_TOOLTIP}
              formatter={(value: number | string) => (typeof value === "number" ? (unit ? `${value}${unit}` : value.toFixed(2)) : value)}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload as MetricRow | undefined
                return p ? formatTime(p.time) : ""
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
            {nodeNames.map((name, i) => {
              const key = name.replace(/[^a-zA-Z0-9_]/g, "_")
              const dataKey = `${fieldPrefix}_${key}`
              return <Line key={dataKey} type="monotone" dataKey={dataKey} name={name} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
            })}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
