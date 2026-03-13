"use client"

import { useState, useEffect, useCallback } from "react"
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
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import type { SnapshotInfo } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"

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
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const [vmGroups, setVmGroups] = useState<VMGroup[]>([])
  const [snapGroups, setSnapGroups] = useState<SnapshotGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"vm" | "snapshot">("vm")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [createDialog, setCreateDialog] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newSnapshotName, setNewSnapshotName] = useState("")
  const [newSnapshotDesc, setNewSnapshotDesc] = useState("")
  const [includeRAM, setIncludeRAM] = useState(true)
  const [vmVisibleCount, setVmVisibleCount] = useState(PAGE_SIZE)
  const [snapshotVisibleCount, setSnapshotVisibleCount] = useState(PAGE_SIZE)

  const fetchSnapshots = useCallback(async () => {
    setLoading(true)
    const result = await ludusApi.listSnapshots()
    if (result.data) {
      const flat = result.data.snapshots ?? []

      // ── Build VM-centric groups ──────────────────────────────────────────
      const vmMap = new Map<string, VMGroup>()
      for (const snap of flat) {
        const key = snap.vmname ?? `vm-${snap.vmid}`
        if (!vmMap.has(key)) {
          vmMap.set(key, { vmname: key, vmid: snap.vmid, snapshots: [] })
        }
        const group = vmMap.get(key)!
        if (snap.name === "current") {
          group.currentSnapshot = snap.parent
        } else {
          group.snapshots.push(snap)
        }
      }
      // Sort snapshots newest-first per VM
      const vmList = Array.from(vmMap.values()).map((g) => ({
        ...g,
        snapshots: g.snapshots.sort((a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0)),
      }))
      setVmGroups(vmList)

      // ── Build snapshot-name groups ───────────────────────────────────────
      const snapMap = new Map<string, SnapshotGroup>()
      for (const snap of flat) {
        if (snap.name === "current") continue
        const existing = snapMap.get(snap.name)
        if (existing) {
          existing.vms.push(snap)
          if (snap.snaptime && (!existing.snaptime || snap.snaptime < existing.snaptime)) {
            existing.snaptime = snap.snaptime
          }
        } else {
          snapMap.set(snap.name, {
            name: snap.name,
            description: snap.description,
            includesRAM: snap.includesRAM ?? false,
            snaptime: snap.snaptime,
            vms: [snap],
          })
        }
      }
      const snapList = Array.from(snapMap.values()).sort(
        (a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0)
      )
      setSnapGroups(snapList)

      // Auto-expand first item
      if (vmList.length > 0) setExpanded(new Set([vmList[0].vmname]))
      setVmVisibleCount(PAGE_SIZE)
      setSnapshotVisibleCount(PAGE_SIZE)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchSnapshots() }, [fetchSnapshots])

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

  const handleCreate = async () => {
    if (!newSnapshotName.trim()) return
    setCreating(true)
    const result = await ludusApi.createSnapshot({
      snapshotName: newSnapshotName.trim(),
      description: newSnapshotDesc || undefined,
      includeRAM,
    })
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Snapshot queued", description: `"${newSnapshotName}" will be created on all VMs` })
      setCreateDialog(false)
      setNewSnapshotName("")
      setNewSnapshotDesc("")
      fetchSnapshots()
    }
    setCreating(false)
  }

  const doRevert = async (snapshotName: string) => {
    const result = await ludusApi.revertSnapshot({ snapshotName })
    if (result.error) {
      toast({ variant: "destructive", title: "Revert failed", description: result.error })
    } else {
      toast({ title: "Reverting…", description: `Rolling back to "${snapshotName}"` })
    }
  }
  const handleRevert = (snapshotName: string, context: string) =>
    confirm(`Revert all VMs to snapshot "${snapshotName}"? ${context} This cannot be undone.`, () => doRevert(snapshotName))

  const doDelete = async (snapshotName: string) => {
    const result = await ludusApi.deleteSnapshot({ snapshotName })
    if (result.error) {
      toast({ variant: "destructive", title: "Delete failed", description: result.error })
    } else {
      toast({ title: "Snapshot deleted" })
      fetchSnapshots()
    }
  }
  const handleDelete = (snapshotName: string, vmCount: number) =>
    confirm(`Delete snapshot "${snapshotName}" from all ${vmCount} VM(s)?`, () => doDelete(snapshotName))

  const totalVMs = vmGroups.length
  const totalSnaps = snapGroups.length

  return (
    <div className="space-y-5">
      {/* Confirm bar */}
      <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />

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
          <Button variant="ghost" size="icon" onClick={fetchSnapshots} disabled={loading}>
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
              A snapshot with this name will be created on <strong>all VMs</strong> in your range simultaneously.
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
  onRevert: (name: string, ctx: string) => void
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
                                onClick={() => onRevert(snap.name, `All VMs will be reverted to "${snap.name}"`)}
                                title="Revert all VMs to this snapshot"
                              >
                                <RotateCcw className="h-3 w-3 text-yellow-400" />
                                Revert
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => onDelete(snap.name, 1)}
                                title="Delete snapshot from all VMs"
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
  onRevert: (name: string, ctx: string) => void
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
                  onClick={() => onRevert(group.name, `All ${group.vms.length} VMs will be reverted to "${group.name}"`)}
                >
                  <RotateCcw className="h-3 w-3 text-yellow-400" />
                  Revert All
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onDelete(group.name, group.vms.length)}
                  title="Delete from all VMs"
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
