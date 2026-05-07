"use client"

import { useState, useEffect, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Camera,
  RefreshCw,
  Plus,
  RotateCcw,
  Trash2,
  Loader2,
  ChevronRight,
  ChevronDown,
  HardDrive,
  Clock,
  Layers,
  MapPin,
  AlertTriangle,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import { snapshotTargetProxmoxIdsExcludingRouter } from "@/lib/ludus-range-router-vm"
import type { LudusSnapshotMutationResult, SnapshotInfo } from "@/lib/types"
import {
  classifySnapshotMutation,
  firstSnapshotMutationErrorMessage,
} from "@/lib/ludus-snapshot-payload"
import { tryToastLudusSlowHttpError } from "@/lib/ludus-timeout-ui"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { useRange } from "@/lib/range-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

// ── derived data types ────────────────────────────────────────────────────────

/** All real snapshots for one VM, with the name of the snapshot it's currently at */
interface VMGroup {
  vmname: string
  vmid?: number
  currentSnapshot?: string   // parent field of the "current" pseudo-entry
  snapshots: SnapshotInfo[]  // real (non-current) snapshots, newest first
}

/** One named snapshot shared across multiple VMs */
interface SnapshotGroup {
  name: string
  description?: string
  includesRAM: boolean
  snaptime?: number
  vms: SnapshotInfo[]
}

interface SnapshotsViewData {
  vmGroups: VMGroup[]
  snapGroups: SnapshotGroup[]
  snapshotsUnsupported?: boolean
}

const PAGE_SIZE = 20

function formatSnaptime(snaptime?: number): string {
  if (!snaptime) return ""
  return new Date(snaptime * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

// ── component ─────────────────────────────────────────────────────────────────

export default function SnapshotsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const scopeTag = useEffectiveScopeTag()
  const { selectedRangeId, loading: rangeCtxLoading } = useRange()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const [view, setView] = useState<"vm" | "snapshot">("vm")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [createDialog, setCreateDialog] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newSnapshotName, setNewSnapshotName] = useState("")
  const [newSnapshotDesc, setNewSnapshotDesc] = useState("")
  const [includeRAM, setIncludeRAM] = useState(true)
  const [vmVisibleCount, setVmVisibleCount] = useState(PAGE_SIZE)
  const [snapshotVisibleCount, setSnapshotVisibleCount] = useState(PAGE_SIZE)

  const { data: snapshotData, isLoading: loading } = useQuery({
    queryKey: queryKeys.snapshots(scopeTag, selectedRangeId),
    enabled: !rangeCtxLoading && !!selectedRangeId,
    queryFn: async (): Promise<SnapshotsViewData> => {
      const empty = (unsupported?: boolean): SnapshotsViewData => ({
        vmGroups: [],
        snapGroups: [],
        snapshotsUnsupported: unsupported,
      })
      const result = await ludusApi.listSnapshots(selectedRangeId ?? undefined)
      if (result.status === 404) return empty(true)
      if (result.error) throw new Error(result.error)
      if (!result.data) return empty()
      const flat = result.data.snapshots ?? []

      // Build VM-centric groups
      const vmMap = new Map<string, VMGroup>()
      for (const snap of flat) {
        const key = snap.vmname ?? `vm-${snap.vmid}`
        if (!vmMap.has(key)) vmMap.set(key, { vmname: key, vmid: snap.vmid, snapshots: [] })
        const group = vmMap.get(key)!
        if (snap.name === "current") group.currentSnapshot = snap.parent
        else group.snapshots.push(snap)
      }
      const vmGroups = Array.from(vmMap.values()).map((g) => ({
        ...g,
        snapshots: g.snapshots.sort((a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0)),
      }))

      // Build snapshot-name groups
      const snapMap = new Map<string, SnapshotGroup>()
      for (const snap of flat) {
        if (snap.name === "current") continue
        const existing = snapMap.get(snap.name)
        if (existing) {
          existing.vms.push(snap)
          if (snap.snaptime && (!existing.snaptime || snap.snaptime < existing.snaptime))
            existing.snaptime = snap.snaptime
        } else {
          snapMap.set(snap.name, {
            name: snap.name, description: snap.description,
            includesRAM: snap.includesRAM ?? false, snaptime: snap.snaptime, vms: [snap],
          })
        }
      }
      const snapGroups = Array.from(snapMap.values()).sort(
        (a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0)
      )
      return { vmGroups, snapGroups, snapshotsUnsupported: false }
    },
    staleTime: STALE.medium,
  })

  const vmGroups = snapshotData?.vmGroups ?? []
  const snapGroups = snapshotData?.snapGroups ?? []

  // Auto-expand first VM group when data first arrives
  useEffect(() => {
    if (vmGroups.length > 0) {
      setExpanded(new Set([vmGroups[0].vmname]))
      setVmVisibleCount(PAGE_SIZE)
      setSnapshotVisibleCount(PAGE_SIZE)
    }
  }, [snapshotData]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Reset expanded items when switching views
  const handleViewChange = (v: string) => {
    setView(v as "vm" | "snapshot")
    if (v === "vm" && vmGroups.length > 0) setExpanded(new Set([vmGroups[0].vmname]))
    else if (v === "snapshot" && snapGroups.length > 0) setExpanded(new Set([snapGroups[0].name]))
    else setExpanded(new Set())
  }

  const snapshotRangeId = selectedRangeId ?? undefined

  type SnapshotVmidsResolution =
    | { ok: true; vmids: number[] }
    | { ok: false; toast: { title: string; description: string } }

  const resolveSnapshotVmids = useCallback(async (): Promise<SnapshotVmidsResolution> => {
    const rid = selectedRangeId?.trim()
    if (!rid) {
      return {
        ok: false,
        toast: { title: "No range selected", description: "Pick a range in the sidebar first." },
      }
    }
    const res = await ludusApi.getRangeStatus(rid)
    if (res.error || !res.data) {
      return {
        ok: false,
        toast: {
          title: "Could not load VMs",
          description: res.error ?? "Ludus did not return range details.",
        },
      }
    }
    const vms = res.data.VMs ?? res.data.vms ?? []
    const vmids = snapshotTargetProxmoxIdsExcludingRouter(vms)
    if (vmids.length === 0) {
      return {
        ok: false,
        toast: {
          title: "No target VMs",
          description:
            vms.length === 0
              ? "This range has no deployed VMs yet."
              : "Only the range router VM was found; snapshots apply to lab VMs (the router is skipped, same as testing mode).",
        },
      }
    }
    return { ok: true, vmids }
  }, [selectedRangeId])

  const applySnapshotMutationToasts = (
    data: LudusSnapshotMutationResult | undefined,
    labels: {
      ok: { title: string; description: string }
      failTitle: string
      partialTitle: string
    },
    onNonFailure?: () => void,
  ) => {
    const kind = classifySnapshotMutation(data)
    if (kind === "fail") {
      toast({
        variant: "destructive",
        title: labels.failTitle,
        description: firstSnapshotMutationErrorMessage(data) ?? "All targets reported an error.",
      })
      return
    }
    if (kind === "partial") {
      const nOk = data?.success?.length ?? 0
      const nErr = data?.errors?.length ?? 0
      toast({
        title: labels.partialTitle,
        description:
          firstSnapshotMutationErrorMessage(data) ?? `${nOk} VM(s) succeeded, ${nErr} failed.`,
      })
      onNonFailure?.()
      return
    }
    toast({ title: labels.ok.title, description: labels.ok.description })
    onNonFailure?.()
  }

  const handleCreate = async () => {
    if (!newSnapshotName.trim()) return
    setCreating(true)
    const nameTrim = newSnapshotName.trim()
    const resolved = await resolveSnapshotVmids()
    if (!resolved.ok) {
      toast({ variant: "destructive", title: resolved.toast.title, description: resolved.toast.description })
      setCreating(false)
      return
    }
    const result = await ludusApi.createSnapshot(
      {
        snapshotName: nameTrim,
        description: newSnapshotDesc || undefined,
        includeRAM,
        vmids: resolved.vmids,
      },
      snapshotRangeId,
    )
    if (result.error) {
      if (
        tryToastLudusSlowHttpError({
          toast,
          error: result.error,
          slowTitle: "Slow response from Ludus",
          onSlow: () => {
            setCreateDialog(false)
            setNewSnapshotName("")
            setNewSnapshotDesc("")
            queryClient.invalidateQueries({ queryKey: queryKeys.snapshotsRoot(scopeTag) })
          },
        })
      ) {
        setCreating(false)
        return
      }
      toast({ variant: "destructive", title: "Error", description: result.error })
      setCreating(false)
      return
    }
    applySnapshotMutationToasts(
      result.data,
      {
        ok: {
          title: "Snapshot queued",
          description: `"${nameTrim}" will be created on ${resolved.vmids.length} lab VM(s) (range router excluded)`,
        },
        failTitle: "Snapshot failed",
        partialTitle: "Snapshot partially completed",
      },
      () => {
        setCreateDialog(false)
        setNewSnapshotName("")
        setNewSnapshotDesc("")
        queryClient.invalidateQueries({ queryKey: queryKeys.snapshotsRoot(scopeTag) })
      },
    )
    setCreating(false)
  }

  const doRevert = async (snapshotName: string) => {
    const resolved = await resolveSnapshotVmids()
    if (!resolved.ok) {
      toast({ variant: "destructive", title: resolved.toast.title, description: resolved.toast.description })
      return
    }
    const result = await ludusApi.revertSnapshot({ snapshotName, vmids: resolved.vmids }, snapshotRangeId)
    if (result.error) {
      if (
        tryToastLudusSlowHttpError({
          toast,
          error: result.error,
          slowTitle: "Slow response from Ludus",
          onSlow: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.snapshotsRoot(scopeTag) })
          },
        })
      ) {
        return
      }
      toast({ variant: "destructive", title: "Revert failed", description: result.error })
      return
    }
    applySnapshotMutationToasts(
      result.data,
      {
        ok: { title: "Reverting…", description: `Rolling back to "${snapshotName}"` },
        failTitle: "Revert failed",
        partialTitle: "Revert partially completed",
      },
      () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.snapshotsRoot(scopeTag) })
      },
    )
  }
  const handleRevert = (snapshotName: string) =>
    confirm(
      `Revert all lab VMs to snapshot "${snapshotName}"? The range router VM is not reverted (same as testing mode). This cannot be undone.`,
      () => doRevert(snapshotName),
    )

  const doDelete = async (snapshotName: string) => {
    const resolved = await resolveSnapshotVmids()
    if (!resolved.ok) {
      toast({ variant: "destructive", title: resolved.toast.title, description: resolved.toast.description })
      return
    }
    const result = await ludusApi.deleteSnapshot({ snapshotName, vmids: resolved.vmids }, snapshotRangeId)
    if (result.error) {
      if (
        tryToastLudusSlowHttpError({
          toast,
          error: result.error,
          slowTitle: "Slow response from Ludus",
          onSlow: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.snapshotsRoot(scopeTag) })
          },
        })
      ) {
        return
      }
      toast({ variant: "destructive", title: "Delete failed", description: result.error })
      return
    }
    applySnapshotMutationToasts(
      result.data,
      {
        ok: { title: "Snapshot deleted", description: `Removed "${snapshotName}" from all targeted VMs` },
        failTitle: "Delete failed",
        partialTitle: "Snapshot partially deleted",
      },
      () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.snapshotsRoot(scopeTag) })
      },
    )
  }
  const handleDelete = (snapshotName: string, _vmCount: number) =>
    confirm(
      `Delete snapshot "${snapshotName}" from all lab VMs? The range router VM is skipped (same as testing mode).`,
      () => doDelete(snapshotName),
    )

  const totalVMs = vmGroups.length
  const totalSnaps = snapGroups.length

  return (
    <div className="space-y-5">
      {/* Confirm bar */}
      <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />

      {snapshotData?.snapshotsUnsupported && (
        <Alert variant="warning" className="gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>
            <AlertTitle className="text-sm">Snapshots API unavailable</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              Ludus returned 404 for <code className="font-mono">GET /api/v2/snapshots/list</code>. Upgrade Ludus to a
              build that registers snapshot routes, or confirm your reverse proxy forwards <code className="font-mono">/api/v2/snapshots/*</code>.
            </AlertDescription>
          </div>
        </Alert>
      )}
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Tabs value={view} onValueChange={handleViewChange}>
            <TabsList>
              <TabsTrigger value="vm" className="gap-1.5">
                <HardDrive className="h-3.5 w-3.5" />
                By VM
              </TabsTrigger>
              <TabsTrigger value="snapshot" className="gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                By Snapshot
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="text-sm text-muted-foreground">
            {totalSnaps} snapshot{totalSnaps !== 1 ? "s" : ""} · {totalVMs} VM{totalVMs !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreateDialog(true)} disabled={!!pendingAction}>
            <Plus className="h-4 w-4" />
            New Snapshot
          </Button>
          <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.snapshotsRoot(scopeTag) })} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : view === "vm" ? (
        <VMView
          vmGroups={vmGroups.slice(0, vmVisibleCount)}
          expanded={expanded}
          toggle={toggle}
          onRevert={handleRevert}
          onDelete={handleDelete}
          hasMore={vmVisibleCount < vmGroups.length}
          onLoadMore={() => setVmVisibleCount((n) => n + PAGE_SIZE)}
        />
      ) : (
        <SnapshotView
          snapGroups={snapGroups.slice(0, snapshotVisibleCount)}
          expanded={expanded}
          toggle={toggle}
          onRevert={handleRevert}
          onDelete={handleDelete}
          hasMore={snapshotVisibleCount < snapGroups.length}
          onLoadMore={() => setSnapshotVisibleCount((n) => n + PAGE_SIZE)}
        />
      )}

      {/* Create dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Snapshot</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              A snapshot with this name will be created on every <strong>lab VM</strong> in your range at once.
              The <code className="text-xs font-mono">*-router-debian*</code> infrastructure VM is skipped — same as testing mode on/off.
            </p>
            <div className="space-y-1.5">
              <Label>Snapshot Name <span className="text-red-400">*</span></Label>
              <Input
                placeholder="pre-attack"
                value={newSnapshotName}
                onChange={(e) => setNewSnapshotName(e.target.value)}
                className="font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                placeholder="Clean state before attack simulation"
                value={newSnapshotDesc}
                onChange={(e) => setNewSnapshotDesc(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={includeRAM} onCheckedChange={setIncludeRAM} />
              <div>
                <Label>Include RAM state</Label>
                <p className="text-xs text-muted-foreground">VMs resume running exactly where they left off on revert</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newSnapshotName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Create Snapshot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── By-VM view ────────────────────────────────────────────────────────────────

function VMView({
  vmGroups,
  expanded,
  toggle,
  onRevert,
  onDelete,
  hasMore,
  onLoadMore,
}: {
  vmGroups: VMGroup[]
  expanded: Set<string>
  toggle: (k: string) => void
  onRevert: (name: string) => void
  onDelete: (name: string, count: number) => void
  hasMore: boolean
  onLoadMore: () => void
}) {
  if (vmGroups.length === 0) return <EmptyState />

  return (
    <div className="space-y-2">
      {vmGroups.map((vm) => {
        const isOpen = expanded.has(vm.vmname)
        const hasSnaps = vm.snapshots.length > 0
        return (
          <Card key={vm.vmname} className="overflow-hidden">
            <button
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
              onClick={() => toggle(vm.vmname)}
            >
              {isOpen
                ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              }
              <HardDrive className="h-4 w-4 text-blue-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-semibold truncate">{vm.vmname}</p>
                {vm.currentSnapshot ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <MapPin className="h-3 w-3 text-green-400" />
                    <span className="text-xs text-muted-foreground">
                      Current: <code className="text-green-400 font-mono">{vm.currentSnapshot}</code>
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">No snapshot applied</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground">
                {vm.vmid && <span className="text-xs opacity-50">#{vm.vmid}</span>}
                <Badge variant={hasSnaps ? "secondary" : "outline"} className="text-xs">
                  {vm.snapshots.length} snap{vm.snapshots.length !== 1 ? "s" : ""}
                </Badge>
              </div>
            </button>

            {isOpen && (
              <CardContent className="pt-0 pb-3">
                <div className="border-t border-border pt-3 ml-7">
                  {!hasSnaps ? (
                    <p className="text-xs text-muted-foreground py-2">No snapshots for this VM</p>
                  ) : (
                    <div className="space-y-1.5">
                      {vm.snapshots.map((snap) => {
                        const isCurrent = snap.name === vm.currentSnapshot
                        return (
                          <div
                            key={snap.name}
                            className={cn(
                              "flex items-center justify-between px-3 py-2.5 rounded-md border text-sm",
                              isCurrent
                                ? "border-green-500/40 bg-green-500/5"
                                : "border-border bg-muted/30"
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Camera className={cn("h-3.5 w-3.5 flex-shrink-0", isCurrent ? "text-green-400" : "text-muted-foreground")} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-xs font-semibold">{snap.name}</span>
                                  {isCurrent && <Badge variant="success" className="text-xs">Current</Badge>}
                                  {snap.includesRAM && <Badge variant="secondary" className="text-xs">RAM</Badge>}
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                                  {snap.description && <span className="truncate max-w-xs">{snap.description}</span>}
                                  {snap.snaptime && (
                                    <span className="flex items-center gap-1 flex-shrink-0">
                                      <Clock className="h-2.5 w-2.5" />
                                      {formatSnaptime(snap.snaptime)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0 ml-3">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => onRevert(snap.name)}
                                title="Revert all lab VMs to this snapshot (router excluded)"
                              >
                                <RotateCcw className="h-3 w-3 text-yellow-400" />
                                Revert
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => onDelete(snap.name, 1)}
                                title="Delete snapshot from all lab VMs (router excluded)"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-red-400" />
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={onLoadMore}>
            Load More VMs
          </Button>
        </div>
      )}
    </div>
  )
}

// ── By-Snapshot view ──────────────────────────────────────────────────────────

function SnapshotView({
  snapGroups,
  expanded,
  toggle,
  onRevert,
  onDelete,
  hasMore,
  onLoadMore,
}: {
  snapGroups: SnapshotGroup[]
  expanded: Set<string>
  toggle: (k: string) => void
  onRevert: (name: string) => void
  onDelete: (name: string, count: number) => void
  hasMore: boolean
  onLoadMore: () => void
}) {
  if (snapGroups.length === 0) return <EmptyState />

  return (
    <div className="space-y-2">
      {snapGroups.map((group) => {
        const isOpen = expanded.has(group.name)
        return (
          <Card key={group.name} className="overflow-hidden">
            <button
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
              onClick={() => toggle(group.name)}
            >
              {isOpen
                ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              }
              <Camera className="h-4 w-4 text-purple-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold">{group.name}</span>
                  {group.includesRAM && <Badge variant="secondary" className="text-xs">RAM</Badge>}
                </div>
                {group.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{group.description}</p>
                )}
              </div>
              <div className="flex items-center gap-4 flex-shrink-0 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3.5 w-3.5" />
                  {group.vms.length} VM{group.vms.length !== 1 ? "s" : ""}
                </span>
                {group.snaptime && (
                  <span className="hidden sm:flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatSnaptime(group.snaptime)}
                  </span>
                )}
              </div>
              <div
                className="flex items-center gap-1 flex-shrink-0 ml-2"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => onRevert(group.name)}
                  title="Revert all lab VMs (router excluded)"
                >
                  <RotateCcw className="h-3 w-3 text-yellow-400" />
                  Revert All
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onDelete(group.name, group.vms.length)}
                  title="Delete snapshot from all lab VMs (router excluded)"
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </Button>
              </div>
            </button>

            {isOpen && (
              <CardContent className="pt-0 pb-3">
                <div className="border-t border-border pt-3 ml-7 space-y-1">
                  {group.vms.map((vm) => (
                    <div
                      key={`${vm.vmname}-${vm.vmid}`}
                      className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/40 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                        <code className="font-mono text-xs">{vm.vmname}</code>
                        {vm.vmid && <span className="text-xs text-muted-foreground">#{vm.vmid}</span>}
                      </div>
                      {vm.snaptime && (
                        <span className="text-xs text-muted-foreground">{formatSnaptime(vm.snaptime)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={onLoadMore}>
            Load More Snapshots
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Shared empty state ────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
        <Camera className="h-10 w-10 mb-3 opacity-40" />
        <p>No snapshots found</p>
        <p className="text-xs mt-1">Create a snapshot to save your range state</p>
      </CardContent>
    </Card>
  )
}
