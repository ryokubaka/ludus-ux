"use client"

import { useState, useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
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
  UserCog,
  AlertTriangle,
  X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { GoadInstance } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useImpersonation } from "@/lib/impersonation-context"
import { useRange } from "@/lib/range-context"
import { useToast } from "@/hooks/use-toast"

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
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(null)
  const { lines: taskLines, resumeTask } = useGoadStream()
  const { impersonation, impersonationHeaders } = useImpersonation()
  const { selectedRangeId } = useRange()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const impUser = impersonation?.username ?? "self"

  // Session-derived state
  const [isAdmin, setIsAdmin] = useState(false)
  const [currentUsername, setCurrentUsername] = useState("")
  useEffect(() => {
    try {
      if (sessionStorage.getItem("isAdmin") === "true") setIsAdmin(true)
    } catch { /* SSR guard */ }
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (d?.isAdmin) setIsAdmin(true)
        if (d?.username) setCurrentUsername(d.username)
      })
      .catch(() => {})
  }, [])

  // Assign dialog state
  const [assignTarget, setAssignTarget] = useState<GoadInstance | null>(null)
  const [assignUsers, setAssignUsers] = useState<{ userID: string }[]>([])
  const [assignUserId, setAssignUserId] = useState("")
  const [assignRangeId, setAssignRangeId] = useState("")
  const [assigning, setAssigning] = useState(false)
  const [usersLoading, setUsersLoading] = useState(false)

  // Pre-load the user list as soon as we know we're an admin
  useEffect(() => {
    if (!isAdmin) return
    setUsersLoading(true)
    fetch("/api/admin/ranges-data")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.users) setAssignUsers(data.users) })
      .catch(() => {})
      .finally(() => setUsersLoading(false))
  }, [isAdmin])

  const openAssignDialog = (instance: GoadInstance) => {
    setAssignTarget(instance)
    setAssignRangeId(instance.ludusRangeId ?? "")
    const currentOwner = instance.ownerUserId
    const match = currentOwner ? assignUsers.find((u) => u.userID === currentOwner) : null
    setAssignUserId(match ? currentOwner! : (assignUsers[0]?.userID ?? ""))
  }

  const handleAssign = async () => {
    if (!assignTarget || !assignUserId) return
    setAssigning(true)
    try {
      const res = await fetch("/api/goad/instances/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: assignTarget.instanceId,
          targetUserId: assignUserId,
          rangeId: assignRangeId.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok && res.status !== 207) {
        toast({ variant: "destructive", title: "Assignment failed", description: data.error ?? `HTTP ${res.status}` })
      } else {
        if (data.errors?.length) {
          toast({ title: "Assigned with warnings", description: data.errors.join("; ") })
        } else {
          toast({ title: "Instance assigned", description: `${assignTarget.instanceId} → ${assignUserId}` })
        }
        setAssignTarget(null)
        invalidateGoad()
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message })
    } finally {
      setAssigning(false)
    }
  }

  // User-scoped query: respects impersonation, returns instances for current/impersonated user.
  const {
    data: instancesData,
    isLoading: loading,
  } = useQuery({
    queryKey: [...queryKeys.goadInstances(), impUser],
    queryFn: async () => {
      const response = await fetch("/api/goad/instances", { headers: impersonationHeaders() })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return { configured: true, instances: [] as GoadInstance[], error: data.error || `HTTP ${response.status}` }
      if (data.configured === false) return { configured: false, instances: [] as GoadInstance[], error: null }
      return { configured: true, instances: (data.instances || []) as GoadInstance[], error: data.error ?? null }
    },
    staleTime: STALE.short,
  })

  // Admin global query: always fetches ALL instances regardless of impersonation.
  // Used for the admin management table so the admin can see and assign every instance.
  const { data: adminInstancesData, isLoading: adminLoading } = useQuery({
    queryKey: [...queryKeys.goadInstances(), "admin-global"],
    queryFn: async () => {
      const response = await fetch("/api/goad/instances?adminView=1")
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.configured === false) return [] as GoadInstance[]
      return (data.instances || []) as GoadInstance[]
    },
    staleTime: STALE.short,
    enabled: isAdmin,
  })

  const configured = instancesData?.configured ?? true
  const error = instancesData?.error ?? null

  // User-scoped instances (current or impersonated user)
  // When impersonating: API already scoped them. When not impersonating as admin: filter from global.
  const allInstances = adminInstancesData ?? []
  const scopedInstances: GoadInstance[] = (() => {
    if (!isAdmin) return instancesData?.instances ?? []
    const filterUser = impersonation?.username ?? currentUsername
    if (!filterUser) return []
    return allInstances.filter((i) => i.ownerUserId === filterUser)
  })()

  // For range-scoped card view
  const rangeInstances = selectedRangeId
    ? scopedInstances.filter((i) => i.ludusRangeId === selectedRangeId)
    : scopedInstances
  const unscopedInstances = selectedRangeId
    ? scopedInstances.filter((i) => !i.ludusRangeId)
    : []

  // Recent GOAD tasks — polls while any task is running
  const { data: tasksData } = useQuery({
    queryKey: [...queryKeys.goadTasks(), impUser],
    queryFn: async () => {
      const res = await fetch("/api/goad/tasks", { headers: impersonationHeaders() })
      const data = await res.json()
      return (data.tasks ?? []).slice(0, 8) as TaskSummary[]
    },
    staleTime: STALE.short,
    refetchInterval: (query) => {
      const tasks = query.state.data as TaskSummary[] | undefined
      return tasks?.some((t) => t.status === "running") ? 3000 : false
    },
  })

  const recentTasks = tasksData ?? []

  const invalidateGoad = () => {
    queryClient.invalidateQueries({ queryKey: [...queryKeys.goadInstances(), impUser] })
    queryClient.invalidateQueries({ queryKey: [...queryKeys.goadInstances(), "admin-global"] })
    queryClient.invalidateQueries({ queryKey: [...queryKeys.goadTasks(), impUser] })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { invalidateGoad() }, [impUser])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "READY": return <Badge variant="success" className="text-xs">Ready</Badge>
      case "PROVIDED": return <Badge variant="info" className="text-xs">Provided</Badge>
      case "CREATED": return <Badge variant="warning" className="text-xs">Created</Badge>
      default: return <Badge variant="secondary" className="text-xs">{status}</Badge>
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

  const renderInstanceCard = (instance: GoadInstance) => (
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
                  {instance.isDefault && <Badge variant="cyan" className="text-xs">Default</Badge>}
                </div>
                <div className="flex gap-4 mt-1.5 flex-wrap">
                  {instance.ownerUserId && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User className="h-3 w-3" />{instance.ownerUserId}
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Wifi className="h-3 w-3" />{instance.ipRange || "—"}
                  </div>
                  {instance.ludusRangeId ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Server className="h-3 w-3" />range: <code className="text-primary">{instance.ludusRangeId}</code>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Server className="h-3 w-3" />{instance.provider}
                    </div>
                  )}
                  {instance.extensions.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Puzzle className="h-3 w-3" />{instance.extensions.join(", ")}
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

  const sectionUsername = impersonation?.username ?? currentUsername

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Game of Active Directory lab instances on your Ludus server
        </p>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/goad/new"><Plus className="h-4 w-4" />New Instance</Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={invalidateGoad} disabled={loading || adminLoading}>
            <RefreshCw className={cn("h-4 w-4", (loading || adminLoading) && "animate-spin")} />
          </Button>
        </div>
      </div>

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

      {configured && (
        <div className="flex gap-6 items-start">
          {/* ── Left: main content ── */}
          <div className="flex-1 min-w-0 space-y-6">

            {/* ── Section 1: Current / impersonated user's instances ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {sectionUsername ? `${sectionUsername}'s Instances` : "My Instances"}
                </p>
                {selectedRangeId && (
                  <span className="text-xs text-muted-foreground">
                    Range: <code className="text-primary font-mono">{selectedRangeId}</code>
                  </span>
                )}
              </div>

              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : rangeInstances.length === 0 && unscopedInstances.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
                    <div className="h-14 w-14 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
                      <Terminal className="h-7 w-7 text-green-400" />
                    </div>
                    <p className="font-medium">No GOAD instances{selectedRangeId ? " in this range" : ""}</p>
                    <Button className="mt-4" asChild>
                      <Link href="/goad/new"><Plus className="h-4 w-4" />Deploy New Instance</Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {rangeInstances.map(renderInstanceCard)}
                  {unscopedInstances.length > 0 && (
                    <div className="pt-1">
                      <p className="text-xs text-muted-foreground/60 mb-2 flex items-center gap-1">
                        <Info className="h-3 w-3" />Legacy instances (no range assigned)
                      </p>
                      {unscopedInstances.map(renderInstanceCard)}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Section 2: Admin management table (all instances) ── */}
            {isAdmin && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <UserCog className="h-3.5 w-3.5" />
                      All Instances — Admin Management
                    </p>
                    {!adminLoading && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {allInstances.length} total ·{" "}
                        {allInstances.filter((i) => !i.ownerUserId || i.ownerUserId === "root").length} unassigned
                      </p>
                    )}
                  </div>
                </div>

                {adminLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : allInstances.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center py-10 text-muted-foreground">
                      <Terminal className="h-7 w-7 text-green-400 mb-2" />
                      <p className="font-medium">No GOAD instances found</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/50 border-b border-border">
                              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Instance ID</th>
                              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Lab</th>
                              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">IP Range</th>
                              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Ludus Range</th>
                              <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Owner</th>
                              <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allInstances.map((inst) => {
                              const isUnassigned = !inst.ownerUserId || inst.ownerUserId === "root"
                              const hasRange = !!inst.ludusRangeId
                              const needsAttention = isUnassigned || !hasRange
                              return (
                                <tr
                                  key={inst.instanceId}
                                  className={cn(
                                    "border-b border-border/50 last:border-0 transition-colors",
                                    needsAttention ? "bg-yellow-500/5 hover:bg-yellow-500/10" : "hover:bg-muted/30"
                                  )}
                                >
                                  <td className="p-3">
                                    <div className="flex items-center gap-2">
                                      {needsAttention && <AlertTriangle className="h-3 w-3 text-yellow-400 shrink-0" />}
                                      <Link
                                        href={`/goad/${encodeURIComponent(inst.instanceId)}`}
                                        className="font-mono text-xs font-bold text-primary hover:underline"
                                      >
                                        {inst.instanceId}
                                      </Link>
                                      {inst.isDefault && <Badge variant="cyan" className="text-[10px] px-1 py-0">default</Badge>}
                                    </div>
                                  </td>
                                  <td className="p-3">
                                    <Badge variant="secondary" className="text-xs">{inst.lab}</Badge>
                                  </td>
                                  <td className="p-3">{getStatusBadge(inst.status)}</td>
                                  <td className="p-3">
                                    <code className="text-xs font-mono text-muted-foreground">{inst.ipRange || "—"}</code>
                                  </td>
                                  <td className="p-3">
                                    {inst.ludusRangeId ? (
                                      <code className="text-xs font-mono text-primary">{inst.ludusRangeId}</code>
                                    ) : (
                                      <span className="text-xs text-yellow-400/80 flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" /> no range
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3">
                                    {inst.ownerUserId && inst.ownerUserId !== "root" ? (
                                      <span className="text-xs font-mono text-foreground">{inst.ownerUserId}</span>
                                    ) : (
                                      <span className="text-xs text-yellow-400/80 flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" />
                                        {inst.ownerUserId === "root" ? "root" : "unassigned"}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-right">
                                    <Button
                                      size="sm"
                                      variant={needsAttention ? "outline" : "ghost"}
                                      className={cn(
                                        "h-7 text-xs gap-1",
                                        needsAttention
                                          ? "border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                                          : "text-muted-foreground hover:text-foreground"
                                      )}
                                      disabled={usersLoading}
                                      onClick={() => openAssignDialog(inst)}
                                    >
                                      {usersLoading
                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                        : <UserCog className="h-3 w-3" />}
                                      {isUnassigned ? "Assign" : "Reassign"}
                                    </Button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* ── Log viewer: appears below instances when a task is selected ── */}
            {selectedTask && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground font-mono truncate flex-1">
                    {selectedTask.command}
                  </p>
                  <Button variant="ghost" size="icon-sm" onClick={() => setSelectedTask(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <GoadTerminal lines={taskLines} className="w-full h-[32rem]" />
              </div>
            )}
          </div>

          {/* ── Right: Recent Operations sidebar (always visible) ── */}
          <div className="w-72 shrink-0 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" />
                Recent Operations
              </p>
              <Button variant="ghost" size="icon-sm" onClick={invalidateGoad}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            {recentTasks.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-center text-xs text-muted-foreground py-8">
                  No operations recorded yet.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {recentTasks.map((task) => (
                  <button
                    key={task.id}
                    className="w-full text-left"
                    onClick={() => {
                      setSelectedTask(selectedTask?.id === task.id ? null : task)
                      if (selectedTask?.id !== task.id) resumeTask(task.id)
                    }}
                  >
                    <Card className={cn(
                      "hover:border-primary/40 transition-colors cursor-pointer",
                      selectedTask?.id === task.id && "border-primary/60 bg-primary/5"
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
                Click an entry to show logs · Full history in each instance&apos;s{" "}
                <span className="font-medium">Logs History</span> tab
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Assign / Reassign dialog ── */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl border-yellow-500/30">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-yellow-500/10 flex items-center justify-center flex-shrink-0">
                  <UserCog className="h-5 w-5 text-yellow-400" />
                </div>
                <div>
                  <p className="font-semibold text-sm">
                    {assignTarget.ownerUserId && assignTarget.ownerUserId !== "root" ? "Reassign Instance" : "Assign Instance"}
                  </p>
                  <code className="text-xs text-muted-foreground font-mono">{assignTarget.instanceId}</code>
                  {assignTarget.ownerUserId && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Current owner: <span className="text-foreground font-mono">{assignTarget.ownerUserId}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Target User</Label>
                {assignUsers.length > 0 ? (
                  <select
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {assignUsers.map((u) => (
                      <option key={u.userID} value={u.userID}>{u.userID}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    placeholder="username"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Ludus Range ID <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  placeholder="e.g. username-lab-XXXXX"
                  value={assignRangeId}
                  onChange={(e) => setAssignRangeId(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave blank to assign the instance without linking a Ludus range.
                </p>
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => setAssignTarget(null)} disabled={assigning}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAssign}
                  disabled={!assignUserId || assigning}
                  className="bg-yellow-600 hover:bg-yellow-700 text-white"
                >
                  {assigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCog className="h-3.5 w-3.5" />}
                  Assign
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
