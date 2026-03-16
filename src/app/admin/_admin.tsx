"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Server,
  RefreshCw,
  Users,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Terminal,
  KeyRound,
  X,
  UserCog,
  ChevronRight,
  ChevronDown,
  Trash2,
  Database,
  Share2,
  Play,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import type { RangeObject, UserObject } from "@/lib/types"
import { cn, getRangeStateBadge } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { saveImpersonation } from "@/lib/impersonation-context"

interface ImpersonateTarget {
  userID: string
  displayName: string
}

// Optimistic-UI overlay: records assignments made in this tab session so they
// appear immediately without waiting for the server to revalidate its cache.
// The server-side SQLite store is the real persistence layer.
const _pinnedAssignments = new Map<string, string>() // rangeID → userID

export function AdminPageClient() {
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()

  // ── Ranges + users data (replaces fetchData + useState) ───────────────────
  const {
    data: adminData,
    isLoading: loading,
    error: adminDataError,
  } = useQuery({
    queryKey: queryKeys.adminRangesData(),
    queryFn: async () => {
      const res = await fetch("/api/admin/ranges-data")
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      return res.json() as Promise<{
        ranges: RangeObject[]
        users: UserObject[]
        ownership: Record<string, string>
      }>
    },
    staleTime: STALE.short,
  })

  const ranges = adminData?.ranges ?? []
  const users = adminData?.users ?? []
  const error = adminDataError ? (adminDataError as Error).message : null

  const [impersonateTarget, setImpersonateTarget] = useState<ImpersonateTarget | null>(null)
  const [impersonateApiKey, setImpersonateApiKey] = useState("")
  const [fetchingKey, setFetchingKey] = useState(false)
  const apiKeyInputRef = useRef<HTMLInputElement>(null)

  // rangeID → RangeObject lookup
  const [rangeByID, setRangeByID] = useState<Map<string, RangeObject>>(new Map())
  // userID → Set<rangeID> — built locally from range.userID + user.defaultRangeID
  const [userRangeIDs, setUserRangeIDs] = useState<Map<string, Set<string>>>(new Map())
  // which user rows are expanded
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())

  // assigning a range: rangeID → userID being assigned
  const [assigningRange, setAssigningRange] = useState<string | null>(null)
  const [assignTarget, setAssignTarget] = useState<string>("")
  const [assignInProgress, setAssignInProgress] = useState(false)

  // ── Shared services (Nexus cache + Ludus Share) ───────────────────────────
  const [deployingShared, setDeployingShared] = useState<"nexus" | "share" | null>(null)
  // vmName → action currently in flight ("poweron" | "poweroff" | "delete")
  const [vmActionLoading, setVmActionLoading] = useState<Map<string, string>>(new Map())

  // VMs from the Proxmox ADMIN pool — discovered via pvesh, NOT from /range/all
  interface SharedAdminVM {
    vmid: number
    name: string
    node: string
    status: "running" | "stopped" | "unknown"
    ip: string
    serviceType: "nexus" | "share" | "other"
  }

  const {
    data: sharedVmsData,
    isLoading: loadingAdminVMs,
  } = useQuery({
    queryKey: queryKeys.adminSharedVms(),
    queryFn: async () => {
      const res = await fetch("/api/admin/shared-vms")
      if (!res.ok) return { vms: [] as SharedAdminVM[] }
      return res.json() as Promise<{ vms: SharedAdminVM[] }>
    },
    staleTime: STALE.short,
  })

  const adminPoolVMs = sharedVmsData?.vms ?? []

  const fetchAdminPoolVMs = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminSharedVms() })
  }, [queryClient])

  const nexusVMs = useMemo(() => adminPoolVMs.filter((v) => v.serviceType === "nexus"), [adminPoolVMs])
  const shareVMs = useMemo(() => adminPoolVMs.filter((v) => v.serviceType === "share"), [adminPoolVMs])

  const deploySharedService = async (service: "nexus" | "share") => {
    setDeployingShared(service)
    try {
      // Use the dedicated admin endpoint — it calls Ludus directly with the
      // admin's own session API key (no impersonation headers), sends only the
      // requested tag, and logs the exact Ludus request server-side for tracing.
      const res = await fetch("/api/admin/deploy-shared-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      })
      const data = await res.json() as {
        ok?: boolean
        error?: string
        debug?: { ludusPath: string; ludusBody: unknown; adminUser: string; ludusResponse?: unknown }
      }
      if (!res.ok || data.error) {
        // Surface the debug info so the user can see exactly what was sent
        const debugStr = data.debug
          ? ` (called Ludus: POST ${data.debug.ludusPath} body=${JSON.stringify(data.debug.ludusBody)})`
          : ""
        toast({
          variant: "destructive",
          title: `Failed to start ${service} deployment`,
          description: `${data.error || `HTTP ${res.status}`}${debugStr}`,
        })
      } else {
        const label = service === "nexus" ? "Nexus cache" : "Ludus Share"
        console.log(`[${label}] deploy triggered:`, data.debug)
        toast({ title: `${label} deployment started`, description: `Running: ludus range deploy -t ${service} — redirecting to logs…` })
        // Refresh pool detection after returning so the new VM shows up
        setTimeout(() => fetchAdminPoolVMs(), 15_000)
        router.push("/")
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message })
    } finally {
      setDeployingShared(null)
    }
  }

  const handleVmPower = async (vm: SharedAdminVM, action: "start" | "stop") => {
    setVmActionLoading((m) => new Map(m).set(vm.name, action))
    try {
      const res = await fetch(
        `/api/admin/vm?proxmoxId=${encodeURIComponent(String(vm.vmid))}&action=${action}`,
        { method: "PUT" },
      )
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || data.error) {
        toast({ variant: "destructive", title: `Power ${action} failed`, description: data.error || `HTTP ${res.status}` })
      } else {
        toast({ title: `${vm.name} ${action === "start" ? "starting" : "stopping"}…` })
        setTimeout(() => fetchAdminPoolVMs(), 3000)
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message })
    } finally {
      setVmActionLoading((m) => { const n = new Map(m); n.delete(vm.name); return n })
    }
  }

  const handleVmConsole = (vm: SharedAdminVM) => {
    const url = `/console?vmId=${encodeURIComponent(String(vm.vmid))}&vmName=${encodeURIComponent(vm.name)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const handleVmDelete = async (vm: SharedAdminVM) => {
    if (!window.confirm(`Delete VM "${vm.name}" from Proxmox? This cannot be undone.`)) return
    setVmActionLoading((m) => new Map(m).set(vm.name, "delete"))
    try {
      const res = await fetch(`/api/admin/vm?proxmoxId=${encodeURIComponent(String(vm.vmid))}`, { method: "DELETE" })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || data.error) {
        toast({ variant: "destructive", title: "Delete failed", description: data.error || `HTTP ${res.status}` })
      } else {
        toast({ title: `${vm.name} deleted` })
        fetchAdminPoolVMs()
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message })
    } finally {
      setVmActionLoading((m) => { const n = new Map(m); n.delete(vm.name); return n })
    }
  }

  // Apply server-returned data + merge optimistic pinned assignments for the current session.
  const applyData = useCallback((
    fetchedRanges: RangeObject[],
    fetchedUsers: UserObject[],
    serverOwnership: Record<string, string>,
  ) => {
    setRangeByID(new Map(fetchedRanges.map((r) => [r.rangeID, r])))

    // Build userID → Set<rangeID> from the server's authoritative ownership map,
    // with optimistic session-local overrides on top.
    const map = new Map<string, Set<string>>()
    for (const u of fetchedUsers) map.set(u.userID, new Set())

    const merged = { ...serverOwnership }
    for (const [rid, uid] of _pinnedAssignments) merged[rid] = uid

    for (const [rangeID, userID] of Object.entries(merged)) {
      if (!map.has(userID)) map.set(userID, new Set())
      // Remove from any previous owner first
      for (const [uid, ids] of map) { if (uid !== userID) ids.delete(rangeID) }
      map.get(userID)!.add(rangeID)
    }

    setUserRangeIDs(map)
    // Preserve expanded rows the user already opened; don't collapse on background refresh
    setExpandedUsers((prev) => new Set([...prev].filter((id) => map.has(id))))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-derive local ownership state whenever the query data changes
  useEffect(() => {
    if (!adminData) return
    applyData(adminData.ranges ?? [], adminData.users ?? [], adminData.ownership ?? {})
  }, [adminData, applyData])

  const invalidateAdminData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminRangesData() })
  }, [queryClient])

  const toggleExpanded = (userID: string) =>
    setExpandedUsers((prev) => {
      const next = new Set(prev)
      if (next.has(userID)) next.delete(userID)
      else next.add(userID)
      return next
    })

  const applyAssignment = useCallback((rangeID: string, userID: string) => {
    setAssigningRange(null)
    setAssignTarget("")
    // Optimistic local overlay — SQLite is the real persistent store now
    _pinnedAssignments.set(rangeID, userID)
    setUserRangeIDs((prev) => {
      const next = new Map(prev)
      if (!next.has(userID)) next.set(userID, new Set())
      next.get(userID)!.add(rangeID)
      // Remove from any other owner's set
      for (const [uid, ids] of next) {
        if (uid !== userID) ids.delete(rangeID)
      }
      return next
    })
    // ranges is derived from adminData (query), so update rangeByID directly
    setRangeByID((prev) => {
      const next = new Map(prev)
      const r = next.get(rangeID)
      if (r) next.set(rangeID, { ...r, userID })
      return next
    })
    setExpandedUsers((prev) => new Set([...prev, userID]))
  }, [])

  const [deletingRange, setDeletingRange] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")

  const handleDeleteRange = async (rangeID: string) => {
    setDeletingRange(null)
    setDeleteConfirmText("")
    _pinnedAssignments.delete(rangeID)
    // Delete the range from Ludus
    const res = await ludusApi.deleteRange(rangeID)
    if (res.error) {
      toast({ variant: "destructive", title: "Delete failed", description: res.error })
      return
    }
    // Remove ownership record from SQLite + bust server cache
    await fetch("/api/admin/ranges-data", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rangeID }),
    }).catch(() => {}) // non-fatal
    toast({ title: "Range deleted", description: `${rangeID} permanently removed` })
    invalidateAdminData()
  }

  const handleAssign = async (rangeID: string, userID: string) => {
    if (!userID) return
    setAssignInProgress(true)
    try {
      const res = await fetch("/api/admin/ranges-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rangeID, userID }),
      })
      const data = await res.json() as { ok?: boolean; confirmed?: boolean; error?: string }
      if (!res.ok && !data.confirmed) {
        toast({ variant: "destructive", title: "Assignment failed", description: data.error })
        return
      }
      toast({
        title: data.confirmed ? "Ownership confirmed" : "Range assigned",
        description: `${rangeID} → ${userID}`,
      })
      applyAssignment(rangeID, userID)
      // Background refresh — server cache is already busted by POST handler
      invalidateAdminData()
    } catch (err) {
      toast({ variant: "destructive", title: "Assignment failed", description: (err as Error).message })
    } finally {
      setAssignInProgress(false)
    }
  }

  /**
   * Attempt to auto-read the user's LUDUS_API_KEY from their ~/.bashrc via root SSH.
   * If found, immediately commit the impersonation and navigate to /goad.
   * If not found, fall back to the manual-entry dialog.
   */
  const startImpersonate = useCallback(async (userID: string, displayName: string) => {
    setFetchingKey(true)
    try {
      const res = await fetch(`/api/admin/fetch-user-apikey?username=${encodeURIComponent(userID)}`)
      const data = await res.json()
      if (data.apiKey) {
        await saveImpersonation({ username: userID, apiKey: data.apiKey })
        toast({ title: `Now managing as ${displayName}` })
        router.push("/")
        return
      }
    } catch {
      // SSH error — fall through to manual dialog
    } finally {
      setFetchingKey(false)
    }
    // Fallback: prompt manually
    setImpersonateTarget({ userID, displayName })
    setImpersonateApiKey("")
    setTimeout(() => apiKeyInputRef.current?.focus(), 50)
  }, [router, toast])

  const commitImpersonate = () => {
    if (!impersonateTarget || !impersonateApiKey.trim()) {
      toast({ variant: "destructive", title: "API key required" })
      return
    }
    saveImpersonation({ username: impersonateTarget.userID, apiKey: impersonateApiKey.trim() })
    toast({ title: `Now managing as ${impersonateTarget.displayName}` })
    setImpersonateTarget(null)
    router.push("/")
  }

  const totalVMs = ranges.reduce((sum, r) => sum + (r.VMs?.length || r.numberOfVMs || 0), 0)
  const deployedRanges = ranges.filter((r) => r.rangeState === "SUCCESS").length
  const deployingRanges = ranges.filter((r) => r.rangeState === "DEPLOYING" || r.rangeState === "WAITING").length

  // Sorted users list — purely alphabetical by userID
  const sortedUsers = useMemo(() =>
    [...users].sort((a, b) => a.userID.localeCompare(b.userID)),
  [users])

  // Ranges with no known owner
  const unclaimedRanges = useMemo(() => {
    const claimed = new Set<string>()
    for (const [, ids] of userRangeIDs) ids.forEach((id) => claimed.add(id))
    return ranges.filter((r) => !claimed.has(r.rangeID))
  }, [ranges, userRangeIDs])

  return (
    <div className="space-y-6">
      {/* Global fetching-key overlay */}
      {fetchingKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-72 shadow-2xl border-primary/30 text-center">
            <CardContent className="p-6 flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Reading API key from server…</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Fallback impersonation dialog (shown when auto-read fails) */}
      {impersonateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl border-primary/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-primary" />
                  Manage as <code className="text-primary font-mono">{impersonateTarget.displayName}</code>
                </CardTitle>
                <Button size="icon-sm" variant="ghost" onClick={() => setImpersonateTarget(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <KeyRound className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Could not auto-read the API key from <code>~/.bashrc</code>. Enter it manually below.
                  Commands will run via <strong>root SSH</strong> + <code>sudo -u {impersonateTarget.displayName}</code>.
                </AlertDescription>
              </Alert>
              <div className="space-y-1.5">
                <Label htmlFor="impersonate-apikey" className="text-xs">
                  {impersonateTarget.displayName}&apos;s Ludus API Key
                </Label>
                <Input
                  id="impersonate-apikey"
                  ref={apiKeyInputRef}
                  type="password"
                  className="font-mono text-xs"
                  placeholder="e.g. USER.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={impersonateApiKey}
                  onChange={(e) => setImpersonateApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && commitImpersonate()}
                />
                <p className="text-xs text-muted-foreground">
                  Find in their <code className="text-primary">~/.bashrc</code> as{" "}
                  <code className="text-primary">LUDUS_API_KEY</code>, or reset via the Users page.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setImpersonateTarget(null)}>Cancel</Button>
                <Button size="sm" onClick={commitImpersonate} disabled={!impersonateApiKey.trim()}>
                  <Terminal className="h-3.5 w-3.5" />
                  Manage Ludus Ranges
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Ranges", value: ranges.length, icon: <Server className="h-4 w-4 text-primary" /> },
          { label: "Deployed", value: deployedRanges, icon: <CheckCircle2 className="h-4 w-4 text-green-400" /> },
          { label: "Deploying", value: deployingRanges, icon: <Activity className="h-4 w-4 text-yellow-400 animate-pulse" /> },
          { label: "Total VMs", value: totalVMs, icon: <Server className="h-4 w-4 text-blue-400" /> },
        ].map(({ label, value, icon }) => (
          <Card key={label} className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                {icon}
              </div>
              <div className="text-2xl font-bold">{loading ? "—" : value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Shared Services — one-time admin deployments for Nexus cache and Ludus Share */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Share2 className="h-4 w-4 text-primary" />
              Shared Services
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Live in the admin Proxmox pool — accessible to all users</span>
              <Button variant="ghost" size="icon" onClick={fetchAdminPoolVMs} disabled={loadingAdminVMs} title="Refresh">
                <RefreshCw className={cn("h-3.5 w-3.5", loadingAdminVMs && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {(
              [
                {
                  key: "nexus" as const,
                  label: "Nexus Cache",
                  description: "Caches packages, ISOs, and apt/yum repos to speed up all range deployments.",
                  icon: <Database className="h-5 w-5 text-blue-400 shrink-0" />,
                  vms: nexusVMs,
                },
                {
                  key: "share" as const,
                  label: "Ludus File Share",
                  description: "Exposes read-only and read-write SMB shares accessible from all range VMs.",
                  icon: <Share2 className="h-5 w-5 text-purple-400 shrink-0" />,
                  vms: shareVMs,
                },
              ] as const
            ).map(({ key, label, description, icon, vms: svcVMs }) => (
              <div key={key} className="rounded-lg border border-border p-3 space-y-2">
                {/* Header row */}
                <div className="flex items-center gap-2">
                  {icon}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground leading-tight">{description}</p>
                  </div>
                  {svcVMs.length === 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2.5 shrink-0"
                      disabled={!!deployingShared}
                      onClick={() => deploySharedService(key)}
                    >
                      {deployingShared === key
                        ? <><Loader2 className="h-3 w-3 animate-spin" /> Deploying…</>
                        : <><Play className="h-3 w-3" /> Deploy</>}
                    </Button>
                  )}
                </div>

                {/* VM rows when deployed */}
                {loadingAdminVMs && svcVMs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pl-7">
                    <Loader2 className="h-3 w-3 animate-spin" /> Checking ADMIN pool…
                  </p>
                ) : svcVMs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pl-7">
                    <XCircle className="h-3 w-3" /> Not detected in ADMIN pool
                  </p>
                ) : (
                  <div className="space-y-1.5 pl-0">
                    {svcVMs.map((vm) => {
                      const poweredOn = vm.status === "running"
                      const loadingAction = vmActionLoading.get(vm.name)
                      return (
                        <div
                          key={vm.name}
                          className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5"
                        >
                          {/* Power indicator */}
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0",
                              poweredOn ? "bg-green-400" : "bg-zinc-500",
                            )}
                          />
                          {/* VM info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono font-medium truncate">{vm.name}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{vm.ip || "—"}</p>
                          </div>
                          {/* Actions */}
                          <div className="flex items-center gap-1">
                            {/* Power toggle */}
                            {poweredOn ? (
                              <Button
                                size="icon-sm" variant="ghost"
                                className="h-6 w-6 text-muted-foreground hover:text-yellow-400"
                                disabled={!!loadingAction}
                                title="Power off"
                                onClick={() => handleVmPower(vm, "stop")}
                              >
                                {loadingAction === "stop"
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <XCircle className="h-3 w-3" />}
                              </Button>
                            ) : (
                              <Button
                                size="icon-sm" variant="ghost"
                                className="h-6 w-6 text-muted-foreground hover:text-green-400"
                                disabled={!!loadingAction}
                                title="Power on"
                                onClick={() => handleVmPower(vm, "start")}
                              >
                                {loadingAction === "start"
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Play className="h-3 w-3" />}
                              </Button>
                            )}
                            {/* Console */}
                            <Button
                              size="icon-sm" variant="ghost"
                              className="h-6 w-6 text-muted-foreground hover:text-primary"
                              disabled={!poweredOn || !!loadingAction}
                              title={poweredOn ? "Open console" : "VM must be powered on"}
                              onClick={() => handleVmConsole(vm)}
                            >
                              <Terminal className="h-3 w-3" />
                            </Button>
                            {/* Delete */}
                            <Button
                              size="icon-sm" variant="ghost"
                              className="h-6 w-6 text-muted-foreground hover:text-red-400"
                              disabled={!!loadingAction}
                              title="Delete VM from Proxmox"
                              onClick={() => handleVmDelete(vm)}
                            >
                              {loadingAction === "delete"
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Trash2 className="h-3 w-3" />}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Users + Ranges table — user-centric, ranges as sub-rows */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Users &amp; Ranges
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={invalidateAdminData} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No users found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="p-3 w-8"></th>
                    <th className="p-3 w-24"></th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">User</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Ranges</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">IP Space</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">VMs</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Running</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Testing</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Last Deploy</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((user) => {
                    const userRanges = [...(userRangeIDs.get(user.userID) ?? [])]
                      .map((rid) => rangeByID.get(rid))
                      .filter(Boolean) as RangeObject[]
                    const isExpanded = expandedUsers.has(user.userID)
                    const totalUserVMs = userRanges.reduce((n, r) => n + (r.VMs?.length || r.numberOfVMs || 0), 0)
                    const totalRunning = userRanges.reduce((n, r) => {
                      const vms = r.VMs || r.vms || []
                      return n + vms.filter((v) => v.poweredOn || v.powerState === "running").length
                    }, 0)
                    const anyTesting = userRanges.some((r) => r.testingEnabled)
                    const lastDeploy = userRanges.reduce<string | null>((latest, r) => {
                      if (!r.lastDeployment) return latest
                      if (!latest || r.lastDeployment > latest) return r.lastDeployment
                      return latest
                    }, null)
                    const lastDeployStr = lastDeploy
                      ? new Date(lastDeploy).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—"
                    // Roll-up status from user's ranges
                    const rolledState = userRanges.find((r) => r.rangeState === "DEPLOYING" || r.rangeState === "WAITING")?.rangeState
                      ?? userRanges.find((r) => r.rangeState === "ERROR")?.rangeState
                      ?? userRanges.find((r) => r.rangeState === "SUCCESS")?.rangeState
                      ?? (userRanges.length > 0 ? "NEVER DEPLOYED" : null)

                    return [
                      /* ── User row ── */
                      <tr
                        key={user.userID}
                        className="border-b border-border/50 hover:bg-muted/20 cursor-pointer select-none"
                        onClick={() => userRanges.length > 0 && toggleExpanded(user.userID)}
                      >
                        {/* Expand toggle */}
                        <td className="p-3 w-8">
                          {userRanges.length > 0 ? (
                            isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <span className="h-3.5 w-3.5 block" />
                          )}
                        </td>
                        {/* Manage button — left of username */}
                        <td className="p-2" onClick={(e) => e.stopPropagation()}>
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1.5 border-primary/30 text-primary hover:bg-primary/10 text-xs whitespace-nowrap"
                                  onClick={() => startImpersonate(user.userID, user.userID)}
                                >
                                  <Terminal className="h-3 w-3" />
                                  Manage
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="text-xs">
                                Manage Ludus as {user.userID}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                        {/* User */}
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <UserCog className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                            <span className="text-xs font-semibold">{user.userID}</span>
                            {user.isAdmin && <Badge variant="secondary" className="text-[9px] px-1 py-0">admin</Badge>}
                          </div>
                        </td>
                        {/* Ranges count */}
                        <td className="p-3">
                          <span className="text-xs text-muted-foreground">
                            {userRanges.length === 0 ? (
                              <span className="italic">no ranges</span>
                            ) : (
                              <span className="font-medium text-foreground">{userRanges.length}</span>
                            )}
                          </span>
                        </td>
                        {/* IP Space rollup */}
                        <td className="p-3">
                          <span className="font-mono text-xs text-muted-foreground">
                            {userRanges.filter((r) => r.rangeNumber).map((r) => `10.${r.rangeNumber}.*`).join(", ") || "—"}
                          </span>
                        </td>
                        {/* Rolled-up status */}
                        <td className="p-3">
                          {rolledState ? (
                            <Badge className={cn("text-[9px] px-1.5", getRangeStateBadge(rolledState))}>
                              {rolledState.replace("NEVER DEPLOYED", "EMPTY")}
                            </Badge>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{totalUserVMs || "—"}</td>
                        <td className="p-3">
                          {totalUserVMs > 0 ? (
                            <span className={cn("text-xs font-medium", totalRunning > 0 ? "text-green-400" : "text-muted-foreground")}>
                              {totalRunning} / {totalUserVMs}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="p-3">
                          {anyTesting
                            ? <Badge variant="warning" className="text-[9px] px-1.5">On</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{lastDeployStr}</td>
                      </tr>,

                      /* ── Range sub-rows (shown when expanded) ── */
                      ...(isExpanded ? userRanges
                        .sort((a, b) => (b.rangeNumber || 0) - (a.rangeNumber || 0))
                        .map((range) => {
                          const vms = range.VMs || range.vms || []
                          const runningVMs = vms.filter((v) => v.poweredOn || v.powerState === "running").length
                          const vmCount = vms.length || range.numberOfVMs || 0
                          const ipPrefix = range.rangeNumber ? `10.${range.rangeNumber}.*` : "—"
                          const deployStr = range.lastDeployment
                            ? new Date(range.lastDeployment).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                            : "—"
                          return (
                            <tr key={`${user.userID}-${range.rangeID}`} className="border-b border-border/30 bg-muted/10 hover:bg-muted/20">
                              <td className="p-0" />
                              <td className="p-0" />
                              {/* Range ID with indented styling */}
                              <td className="p-3 pl-8" colSpan={1}>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-px h-4 bg-border/60 mr-1" />
                                  <Server className="h-3 w-3 text-primary/70 flex-shrink-0" />
                                  <code className="font-mono text-xs text-primary">{range.rangeID}</code>
                                </div>
                              </td>
                              <td className="p-3 text-xs text-muted-foreground">{range.name || range.rangeID}</td>
                              {/* IP Space for this range */}
                              <td className="p-3">
                                <span className="font-mono text-xs text-muted-foreground">{ipPrefix}</span>
                              </td>
                              <td className="p-3">
                                <Badge className={cn("text-[9px] px-1.5", getRangeStateBadge(range.rangeState || "NEVER DEPLOYED"))}>
                                  {range.rangeState || "NEVER DEPLOYED"}
                                </Badge>
                              </td>
                              <td className="p-3 text-xs text-muted-foreground">{vmCount}</td>
                              <td className="p-3">
                                {vmCount > 0 ? (
                                  <span className={cn("text-xs font-medium", runningVMs > 0 ? "text-green-400" : "text-muted-foreground")}>
                                    {runningVMs} / {vmCount}
                                  </span>
                                ) : <span className="text-xs text-muted-foreground">—</span>}
                              </td>
                              <td className="p-3">
                                {range.testingEnabled
                                  ? <Badge variant="warning" className="text-[9px] px-1.5">On</Badge>
                                  : <span className="text-xs text-muted-foreground">Off</span>}
                              </td>
                              <td className="p-3 text-xs text-muted-foreground">{deployStr}</td>
                              {/* Delete range */}
                              <td className="p-2 text-right">
                                {deletingRange === range.rangeID ? (
                                  <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-[10px] text-red-400 whitespace-nowrap">Type&nbsp;<code className="font-mono">{range.rangeID}</code>&nbsp;to confirm:</span>
                                    <Input
                                      value={deleteConfirmText}
                                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                                      className="h-6 w-28 text-xs font-mono border-red-500/50"
                                      placeholder={range.rangeID}
                                      autoFocus
                                    />
                                    <Button
                                      size="icon-sm"
                                      variant="destructive"
                                      className="h-6 w-6"
                                      disabled={deleteConfirmText !== range.rangeID}
                                      onClick={() => handleDeleteRange(range.rangeID)}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      size="icon-sm"
                                      variant="ghost"
                                      className="h-6 w-6 text-muted-foreground"
                                      onClick={() => { setDeletingRange(null); setDeleteConfirmText("") }}
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <TooltipProvider delayDuration={200}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon-sm"
                                          variant="ghost"
                                          className="h-6 w-6 text-red-400/50 hover:text-red-400 hover:bg-red-400/10"
                                          onClick={(e) => { e.stopPropagation(); setDeletingRange(range.rangeID); setDeleteConfirmText("") }}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="text-xs">
                                        Delete range {range.rangeID}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </td>
                            </tr>
                          )
                        }) : []),
                    ]
                  })}

                  {/* Unclaimed ranges — no owner known; show Assign button */}
                  {unclaimedRanges.length > 0 && (
                    <tr className="border-b border-border/50 bg-yellow-500/5">
                      <td colSpan={9} className="px-3 py-1.5 text-[10px] text-yellow-500 uppercase tracking-wider font-semibold">
                        Unassigned ranges — use the Assign button to link them to a user
                      </td>
                    </tr>
                  )}
                  {unclaimedRanges.map((range) => {
                    const vms = range.VMs || range.vms || []
                    const runningVMs = vms.filter((v) => v.poweredOn || v.powerState === "running").length
                    const vmCount = vms.length || range.numberOfVMs || 0
                    const ipPrefix = range.rangeNumber ? `10.${range.rangeNumber}.*` : "—"
                    const deployStr = range.lastDeployment
                      ? new Date(range.lastDeployment).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—"
                    const isAssigning = assigningRange === range.rangeID
                    return (
                      <tr key={range.rangeID} className="border-b border-border/30 bg-yellow-500/5 hover:bg-yellow-500/10">
                        <td className="p-3 w-8" />
                        {/* Assign button or inline assign form */}
                        <td className="p-2">
                          {isAssigning ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={assignTarget}
                                onChange={(e) => setAssignTarget(e.target.value)}
                                className="h-7 text-xs rounded border border-border bg-background px-1.5 max-w-[120px]"
                              >
                                <option value="">User...</option>
                                {sortedUsers.map((u) => (
                                  <option key={u.userID} value={u.userID}>{u.userID}</option>
                                ))}
                              </select>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="h-7 w-7 text-green-400 hover:text-green-300"
                                disabled={!assignTarget || assignInProgress}
                                onClick={() => handleAssign(range.rangeID, assignTarget)}
                              >
                                {assignInProgress ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground"
                                onClick={() => { setAssigningRange(null); setAssignTarget("") }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 text-xs whitespace-nowrap"
                              onClick={() => { setAssigningRange(range.rangeID); setAssignTarget("") }}
                            >
                              <UserCog className="h-3 w-3" />
                              Assign
                            </Button>
                          )}
                        </td>
                        <td className="p-3" colSpan={1}>
                          <div className="flex items-center gap-1.5">
                            <Server className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                            <code className="font-mono text-xs text-yellow-400">{range.rangeID}</code>
                            {ipPrefix !== "—" && <code className="text-[10px] text-muted-foreground font-mono">{ipPrefix}</code>}
                          </div>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{range.name || range.rangeID}</td>
                        <td className="p-3">
                          <Badge className={cn("text-[9px] px-1.5", getRangeStateBadge(range.rangeState || "NEVER DEPLOYED"))}>
                            {range.rangeState || "NEVER DEPLOYED"}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{vmCount}</td>
                        <td className="p-3">
                          {vmCount > 0
                            ? <span className={cn("text-xs font-medium", runningVMs > 0 ? "text-green-400" : "text-muted-foreground")}>{runningVMs} / {vmCount}</span>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="p-3">
                          {range.testingEnabled
                            ? <Badge variant="warning" className="text-[9px] px-1.5">On</Badge>
                            : <span className="text-xs text-muted-foreground">Off</span>}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{deployStr}</td>
                        {/* Delete range */}
                        <td className="p-2 text-right">
                          {deletingRange === range.rangeID ? (
                            <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                              <span className="text-[10px] text-red-400 whitespace-nowrap">Type&nbsp;<code className="font-mono">{range.rangeID}</code>&nbsp;to confirm:</span>
                              <Input
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                className="h-6 w-28 text-xs font-mono border-red-500/50"
                                placeholder={range.rangeID}
                                autoFocus
                              />
                              <Button
                                size="icon-sm"
                                variant="destructive"
                                className="h-6 w-6"
                                disabled={deleteConfirmText !== range.rangeID}
                                onClick={() => handleDeleteRange(range.rangeID)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="h-6 w-6 text-muted-foreground"
                                onClick={() => { setDeletingRange(null); setDeleteConfirmText("") }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="h-6 w-6 text-red-400/50 hover:text-red-400 hover:bg-red-400/10"
                                    onClick={(e) => { e.stopPropagation(); setDeletingRange(range.rangeID); setDeleteConfirmText("") }}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="text-xs">
                                  Delete range {range.rangeID}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
