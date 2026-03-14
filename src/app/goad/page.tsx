"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { GoadTerminal, useGoadStream } from "@/components/goad/goad-terminal"
import {
  Terminal,
  Plus,
  RefreshCw,
  Loader2,
  Server,
  Puzzle,
  ChevronRight,
  Info,
  Wifi,
  Clock,
  History,
  Activity,
  User,
  X,
} from "lucide-react"
import type { GoadInstance } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useImpersonation } from "@/lib/impersonation-context"
import { useRange } from "@/lib/range-context"

export interface ImpersonationContext {
  username: string
  apiKey: string
}
interface TaskSummary {
  id: string
  command: string
  instanceId?: string
  status: string
  startedAt: number
  endedAt?: number
  lineCount: number
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}

export default function GoadPage() {
  const [instances, setInstances] = useState<GoadInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recentTasks, setRecentTasks] = useState<TaskSummary[]>([])
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(null)
  const { lines: taskLines, resumeTask } = useGoadStream()
  const { impersonationHeaders } = useImpersonation()
  const { selectedRangeId } = useRange()

  const fetchInstances = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/goad/instances", { headers: impersonationHeaders() })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setConfigured(true)
        setInstances([])
        setError(data.error || `Failed to load GOAD instances (HTTP ${response.status})`)
        return
      }
      // configured:false means SSH host isn't set — show the setup warning.
      // Any other error (SSH auth failure, runtime error) shows an error banner.
      if (data.configured === false) {
        setConfigured(false)
        setInstances([])
      } else {
        setConfigured(true)
        if (data.error) setError(data.error)
        setInstances(data.instances || [])
      }
    } catch (err) {
      setConfigured(true)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [impersonationHeaders]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRecentTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/goad/tasks", { headers: impersonationHeaders() })
      const data = await res.json()
      setRecentTasks((data.tasks ?? []).slice(0, 5))
    } catch {}
  }, [impersonationHeaders]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch whenever impersonation context changes (enter or exit)
  useEffect(() => {
    fetchInstances()
    fetchRecentTasks()
  }, [fetchInstances, fetchRecentTasks])

  // Auto-refresh while any task is running
  useEffect(() => {
    const running = recentTasks.some((t) => t.status === "running")
    if (!running) return
    const timer = setInterval(fetchRecentTasks, 3000)
    return () => clearInterval(timer)
  }, [recentTasks, fetchRecentTasks])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "READY":
        return <Badge variant="success" className="text-xs">Ready</Badge>
      case "PROVIDED":
        return <Badge variant="info" className="text-xs">Provided</Badge>
      case "CREATED":
        return <Badge variant="warning" className="text-xs">Created</Badge>
      default:
        return <Badge variant="secondary" className="text-xs">{status}</Badge>
    }
  }

  const getTaskBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge variant="success" className="text-xs">Done</Badge>
      case "running": return <Badge variant="warning" className="text-xs animate-pulse">Running</Badge>
      case "error": return <Badge variant="destructive" className="text-xs">Error</Badge>
      case "aborted": return <Badge variant="secondary" className="text-xs">Aborted</Badge>
      default: return <Badge variant="secondary" className="text-xs">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Game of Active Directory lab instances on your Ludus server
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/goad/new">
              <Plus className="h-4 w-4" />
              New Instance
            </Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => { fetchInstances(); fetchRecentTasks() }} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* SSH not configured warning */}
      {!configured && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium mb-1">GOAD SSH not configured</p>
            <p className="text-xs">
              Set <code className="text-primary">LUDUS_SSH_HOST</code> in your <code className="text-primary">.env</code> file, or
              configure it on the <Link href="/settings" className="text-primary underline">Settings</Link> page.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-5 gap-6">
        {/* Instances column (3/5) */}
        <div className="col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Instances
            </p>
            {selectedRangeId && (
              <span className="text-xs text-muted-foreground">
                Range: <code className="text-primary font-mono">{selectedRangeId}</code>
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (() => {
            // Instances scoped to the currently selected Ludus range.
            // Instances with no ludusRangeId are legacy/unscoped — shown separately.
            const rangeInstances = selectedRangeId
              ? instances.filter((i) => i.ludusRangeId === selectedRangeId)
              : instances
            const unscopedInstances = selectedRangeId
              ? instances.filter((i) => !i.ludusRangeId)
              : []

            if (!configured) return null

            const renderCard = (instance: typeof instances[number]) => (
              <Link key={instance.instanceId} href={`/goad/${encodeURIComponent(instance.instanceId)}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer group">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                          <Terminal className="h-5 w-5 text-green-400" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="font-mono text-sm font-bold">{instance.instanceId}</code>
                            <Badge variant="secondary" className="text-xs">{instance.lab}</Badge>
                            {getStatusBadge(instance.status)}
                            {instance.isDefault && (
                              <Badge variant="cyan" className="text-xs">Default</Badge>
                            )}
                          </div>
                          <div className="flex gap-4 mt-1.5 flex-wrap">
                            {instance.ownerUserId && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <User className="h-3 w-3" />
                                {instance.ownerUserId}
                              </div>
                            )}
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Wifi className="h-3 w-3" />
                              {instance.ipRange || "—"}
                            </div>
                            {instance.ludusRangeId && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Server className="h-3 w-3" />
                                <span title="Ludus range ID">range: <code className="text-primary">{instance.ludusRangeId}</code></span>
                              </div>
                            )}
                            {!instance.ludusRangeId && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Server className="h-3 w-3" />
                                {instance.provider}
                              </div>
                            )}
                            {instance.extensions.length > 0 && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Puzzle className="h-3 w-3" />
                                {instance.extensions.join(", ")}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )

            return (
              <>
                {rangeInstances.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
                      <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                        <Terminal className="h-8 w-8 text-green-400" />
                      </div>
                      <p className="font-medium">No GOAD instances in this range</p>
                      <p className="text-sm mt-2 text-center max-w-sm">
                        {selectedRangeId
                          ? "Deploy a new instance — it will be assigned its own dedicated range automatically."
                          : "Deploy a new GOAD instance to start building vulnerable Active Directory environments."}
                      </p>
                      <Button className="mt-6" asChild>
                        <Link href="/goad/new">
                          <Plus className="h-4 w-4" />
                          Deploy New Instance
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  rangeInstances.map(renderCard)
                )}

                {unscopedInstances.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs text-muted-foreground/60 mb-2 flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Legacy instances (no range assigned) — switch ranges to manage
                    </p>
                    {unscopedInstances.map(renderCard)}
                  </div>
                )}
              </>
            )
          })()}
        </div>

        {/* Recent activity column (2/5) */}
        <div className="col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              Recent Operations
            </p>
            <Button variant="ghost" size="icon-sm" onClick={fetchRecentTasks}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {recentTasks.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-center text-xs text-muted-foreground py-8">
                No operations recorded yet. Run a GOAD command to see output here.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {recentTasks.map((task) => (
                <button
                  key={task.id}
                  className="w-full text-left"
                  onClick={() => {
                    setSelectedTask(task)
                    resumeTask(task.id)
                  }}
                >
                  <Card className={cn(
                    "hover:border-primary/40 transition-colors cursor-pointer",
                    selectedTask?.id === task.id && "border-primary/60"
                  )}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          {task.status === "running" ? (
                            <Activity className="h-3.5 w-3.5 text-green-400 animate-pulse flex-shrink-0" />
                          ) : (
                            <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          )}
                          {task.instanceId ? (
                            <Link
                              href={`/goad/${encodeURIComponent(task.instanceId)}`}
                              className="font-mono text-xs text-primary truncate max-w-[100px] hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {task.instanceId}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground italic">new deploy</span>
                          )}
                        </div>
                        {getTaskBadge(task.status)}
                      </div>
                      <code className="font-mono text-xs text-muted-foreground block truncate">
                        {task.command}
                      </code>
                      <div className="flex justify-between mt-1">
                        <span className="text-xs text-muted-foreground/60">{timeAgo(task.startedAt)}</span>
                        <span className="text-xs text-muted-foreground/60">{task.lineCount} lines</span>
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}

          {recentTasks.length > 0 && (
            <p className="text-xs text-muted-foreground/60 text-center px-2 pt-1">
              Showing 5 most recent · Full history in each instance&apos;s{" "}
              <span className="font-medium">Logs History</span> tab
            </p>
          )}

          {/* Inline log viewer for selected task — max height prevents unbounded growth */}
          {selectedTask && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-muted-foreground font-mono truncate flex-1">
                  {selectedTask.command}
                </p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSelectedTask(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <GoadTerminal lines={taskLines} className="w-full h-[32rem]" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
