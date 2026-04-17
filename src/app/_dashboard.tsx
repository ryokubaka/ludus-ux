"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { VMTable } from "@/components/range/vm-table"
import { LogViewer } from "@/components/range/log-viewer"
import { PaginatedLogHistoryList } from "@/components/range/log-history-list"
import { timeAgo } from "@/lib/utils"
import { VmOperationLogList } from "@/components/range/vm-operation-log-list"
import {
  Server,
  Layers,
  Activity,
  RefreshCw,
  Play,
  StopCircle,
  Power,
  PowerOff,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Wifi,
  ChevronDown,
  ChevronRight,
  List,
  FileCode2,
  Download,
  X,
  Trash2,
  History,
  ArrowLeft,
  Puzzle,
  ExternalLink,
  ShieldAlert,
} from "lucide-react"
import { ludusApi, getImpersonationHeaders, getVmOperationLog, pruneKnownHosts } from "@/lib/api"
import {
  LUX_EXT_INSTALL_QUEUE_EVENT,
  luxExtInstallQueueStorageKey,
  type LuxExtInstallQueuePayload,
} from "@/lib/ext-install-queue"
import {
  goadTaskShortKind,
  correlateHistoryEntries,
  aggregateDeployStatuses,
  type GoadTaskForCorrelation,
} from "@/lib/goad-deploy-history-correlation"
import { useRange } from "@/lib/range-context"
import type { RangeObject, VMObject, LogHistoryEntry } from "@/lib/types"
import { cn, getRangeStateBadge } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useDeployLogContext } from "@/lib/deploy-log-context"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import {
  clearRangeAborting,
  isRangeAborting,
} from "@/lib/range-aborting"
import { useAbortRange } from "@/lib/use-abort-range"

/** Re-open inventory for the same range without waiting on Ludus again. */
const INVENTORY_CACHE_MS = 3 * 60 * 1000

function dedupeVMs(vms: VMObject[]): VMObject[] {
  const seen = new Set<number | string>()
  return vms.filter((vm) => {
    const key = vm.proxmoxID ?? vm.ID
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function DashboardPageClient() {
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const { abortRange } = useAbortRange()
  const {
    selectedRangeId,
    ranges: accessibleRanges,
    loading: rangeCtxLoading,
    rangesFetching,
    selectRange,
    refreshRanges,
  } = useRange()

  const hasNoRanges = !rangeCtxLoading && accessibleRanges.length === 0 && !selectedRangeId

  // ── UI state ────────────────────────────────────────────────────────────────
  const [expandedRanges, setExpandedRanges] = useState<Set<string>>(new Set())
  const [wireguardDownloading, setWireguardDownloading] = useState(false)
  /** Modal inventory — same path as before: client → /api/proxy → Ludus (impersonation headers on every ludusApi call). */
  const [inventoryDialog, setInventoryDialog] = useState<{ rangeId: string; label: string; text: string } | null>(null)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const inventoryCacheRef = useRef(new Map<string, { text: string; at: number }>())
  const [deletingRangeId, setDeletingRangeId] = useState<string | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [downloadingVm, setDownloadingVm] = useState<string | null>(null)
  // "Aborting…" optimistic window — driven by markRangeAborting/isRangeAborting
  // so both this component and the GOAD page see the same post-abort state.
  // Re-evaluated on range change and on a 1s ticker while active.
  const [abortingTick, setAbortingTick] = useState(0)
  const aborting = isRangeAborting(selectedRangeId)
  useEffect(() => {
    if (!aborting) return
    const id = setInterval(() => setAbortingTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [aborting])
  // Keep linter quiet about abortingTick "unused" — it only exists to force
  // rerenders while the grace window is counting down.
  void abortingTick
  const [openingVm, setOpeningVm] = useState<string | null>(null)
  const [deployHistoryOpen, setDeployHistoryOpen] = useState(false)
  const [deployHistorySelectedId, setDeployHistorySelectedId] = useState<string | null>(null)
  const [vmOperationLogOpen, setVmOperationLogOpen] = useState(false)
  const [deployHistoryLines, setDeployHistoryLines] = useState<string[]>([])
  const [deployHistoryDetailLoading, setDeployHistoryDetailLoading] = useState(false)

  // ── Deploy log stream ───────────────────────────────────────────────────────
  const { lines: logLines, isStreaming, rangeState: streamRangeState, activeRangeId: streamingRangeId, startStreaming, stopStreaming, clearLogs } = useDeployLogContext()

  // ── Range status query ──────────────────────────────────────────────────────
  // Replaces fetchRanges + silentRefresh + setInterval(silentRefresh, 15000).
  // - isLoading is true ONLY on the very first fetch (no cached data available)
  // - isFetching is true during any background revalidation
  // - refetchInterval keeps the dashboard live without manual polling code
  const {
    data: rangeData,
    isLoading,
    isFetching,
    isPlaceholderData,
    error: rangeError,
    refetch: refetchRangeStatus,
    dataUpdatedAt: rangeDataUpdatedAt,
  } = useQuery({
    queryKey: queryKeys.rangeStatus(selectedRangeId),
    queryFn: async () => {
      const result = await ludusApi.getRangeStatus(selectedRangeId ?? undefined)
      if (result.error) {
        // A 400 with no selectedRangeId just means no default range — not an error worth showing
        if (result.status === 400 && !selectedRangeId) return null
        throw new Error(typeof result.error === "string" ? result.error : "Failed to load range status")
      }
      if (!result.data) return null
      const data = result.data
      const rawVMs = data.VMs || (data as RangeObject & { vms?: VMObject[] }).vms || []
      const newVMs = dedupeVMs(rawVMs)

      // Ludus GET /range occasionally returns an empty VMs array mid-deploy or
      // during short Proxmox hiccups, even though the VMs still exist. When
      // that happens, prefer the previously-cached VM list so rows don't flash
      // in and out of existence. We only trust an empty response when the
      // range is in a terminal state where "no VMs" is meaningful.
      const prev = queryClient.getQueryData<RangeObject>(queryKeys.rangeStatus(selectedRangeId))
      const prevVMs = prev?.VMs || (prev as (RangeObject & { vms?: VMObject[] }) | undefined)?.vms || []
      const state = (data.rangeState || "").toString().toUpperCase()
      const terminal = state === "DESTROYED" || state === "NEVER DEPLOYED" || state === "ERROR"
      const vms = newVMs.length === 0 && prevVMs.length > 0 && !terminal ? prevVMs : newVMs

      return { ...data, VMs: vms }
    },
    enabled: !rangeCtxLoading && !hasNoRanges,
    staleTime: STALE.realtime,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    // When selectedRangeId transitions from null → saved ID, keep showing
    // the previous key's data as a placeholder while the new key fetches.
    // Prevents the "data disappears → loading → data reappears" flash.
    placeholderData: keepPreviousData,
  })

  // ── Version query ───────────────────────────────────────────────────────────
  const { data: versionData } = useQuery({
    queryKey: queryKeys.version(),
    queryFn: async () => {
      const result = await ludusApi.getVersion()
      return result.data ?? null
    },
    staleTime: STALE.long,
  })
  const version = versionData ? (versionData.result || versionData.version || "") : ""

  const { data: deployHistoryEntries = [], isLoading: deployHistoryListLoading, isFetching: deployHistoryRefreshing } =
    useQuery({
      queryKey: queryKeys.rangeLogHistory(selectedRangeId),
      queryFn: async () => {
        const result = await ludusApi.getRangeLogHistory(selectedRangeId ?? undefined)
        return result.data ?? []
      },
    enabled: !rangeCtxLoading && !hasNoRanges && !!selectedRangeId,
    staleTime: STALE.short,
  })

  /** True when Ludus or deploy history suggests work in flight — keep polling GOAD tasks even if the last /tasks fetch had no "running" row yet (race / gap between installs). */
  const shouldPollGoadTasksAux = useMemo(() => {
    const hist = deployHistoryEntries.some((e) => {
      const s = (e.status || "").toLowerCase()
      return s === "running" || s === "waiting"
    })
    const rs = (rangeData?.rangeState ?? "").toString().toUpperCase()
    const rangeBusy = rs === "DEPLOYING" || rs === "WAITING"
    return hist || rangeBusy
  }, [deployHistoryEntries, rangeData?.rangeState])

  const { data: goadInstanceForRange = null } = useQuery({
    queryKey: queryKeys.goadInstanceForRange(selectedRangeId ?? ""),
    queryFn: async () => {
      if (!selectedRangeId) return null
      const res = await fetch(`/api/goad/by-range?rangeId=${encodeURIComponent(selectedRangeId)}`)
      if (!res.ok) return null
      const data = (await res.json()) as { instanceId?: string | null }
      return data.instanceId && typeof data.instanceId === "string" ? data.instanceId : null
    },
    enabled: !rangeCtxLoading && !hasNoRanges && !!selectedRangeId,
    staleTime: STALE.short,
  })

  const { data: goadTasksForRange, isLoading: goadTasksListLoading } = useQuery({
    queryKey: [...queryKeys.goadTasks(), "for-instance", goadInstanceForRange ?? ""],
    queryFn: async () => {
      const iid = goadInstanceForRange!
      const res = await fetch("/api/goad/tasks", { headers: getImpersonationHeaders() })
      if (!res.ok) return [] as GoadTaskForCorrelation[]
      const data = (await res.json()) as { tasks?: GoadTaskForCorrelation[] }
      const all = data.tasks ?? []
      return all.filter((t) => t.instanceId === iid || t.command.includes(iid))
    },
    enabled: !rangeCtxLoading && !hasNoRanges && !!goadInstanceForRange,
    staleTime: STALE.short,
    // Poll while any GOAD task is running so the dashboard picks up
    // provide / install-extension / provision-lab activity that continues
    // after the Ludus range deploy flips to "success".
    // Also poll while Ludus is DEPLOYING/WAITING or deploy history shows a live
    // deploy row — otherwise the first fetch often has no "running" task yet and
    // polling stays off until a manual refresh invalidates.
    refetchInterval: (q) => {
      const tasksRunning = (q.state.data ?? []).some((t) => t.status === "running")
      return tasksRunning || shouldPollGoadTasksAux ? 3000 : false
    },
  })

  // ── VM operation audit log (destroy_vm / remove_extension) ───────────────
  // Scoped to the currently selected range; the GET route filters to the
  // effective user automatically for non-admins.
  const {
    data: vmOperationEntries = [],
    isLoading: vmOperationLoading,
    isFetching: vmOperationRefreshing,
  } = useQuery({
    queryKey: queryKeys.vmOperationLog(selectedRangeId),
    queryFn: async () => {
      const res = await getVmOperationLog({ rangeId: selectedRangeId ?? undefined })
      return res.entries
    },
    enabled: !rangeCtxLoading && !hasNoRanges && !!selectedRangeId,
    staleTime: STALE.short,
  })

  // Refresh VM operation list when any page writes a new audit row
  // (VM destroy from Dashboard, GOAD remove-extension, Range Logs, ...).
  useEffect(() => {
    const handler = () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.vmOperationLog(selectedRangeId) })
    window.addEventListener("vm-operation-log-updated", handler)
    return () => window.removeEventListener("vm-operation-log-updated", handler)
  }, [queryClient, selectedRangeId])

  const clearDeployHistorySelection = useCallback(() => {
    setDeployHistorySelectedId(null)
    setDeployHistoryLines([])
  }, [])

  const handleSelectDeployHistory = useCallback(
    async (logId: string) => {
      setDeployHistoryOpen(true)
      setDeployHistorySelectedId(logId)
      setDeployHistoryLines([])
      setDeployHistoryDetailLoading(true)
      const tasks = goadTasksForRange ?? []
      const row = correlateHistoryEntries(deployHistoryEntries, tasks).find(
        (c) => c.deployEntry?.id === logId || c.mergedBatchDeploys?.some((d) => d.id === logId),
      )
      const deployIds =
        row?.mergedBatchDeploys && row.mergedBatchDeploys.length > 0
          ? [...row.mergedBatchDeploys]
              .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
              .map((d) => d.id)
          : [logId]
      const lines: string[] = []
      for (const id of deployIds) {
        const result = await ludusApi.getRangeLogHistoryById(id, selectedRangeId ?? undefined)
        if (result.data?.result) {
          if (deployIds.length > 1) lines.push(`--- Ludus range deploy ${id} ---`)
          lines.push(...result.data.result.split("\n").filter((l) => l.trim()))
        } else if (result.error && deployIds.length === 1) {
          toast({ variant: "destructive", title: "Failed to load log", description: result.error })
        }
      }
      setDeployHistoryLines(lines)
      setDeployHistoryDetailLoading(false)
    },
    [selectedRangeId, toast, deployHistoryEntries, goadTasksForRange],
  )

  // ── Auto-expand range when data arrives ────────────────────────────────────
  useEffect(() => {
    if (!rangeData) return
    const rangeKey = rangeData.rangeID || rangeData.name || "range-0"
    setExpandedRanges((e) => (e.has(rangeKey) ? e : new Set([...e, rangeKey])))
  }, [rangeData])

  useEffect(() => {
    setDeployHistoryOpen(false)
    clearDeployHistorySelection()
  }, [selectedRangeId, clearDeployHistorySelection])

  // ── Reset stream state on range change ─────────────────────────────────────
  useEffect(() => {
    if (rangeCtxLoading) return
    const streamIsForThisRange = isStreaming && streamingRangeId === (selectedRangeId ?? null)
    if (!streamIsForThisRange) {
      stopStreaming()
      clearLogs()
    }
    setShowLogs(streamIsForThisRange)
    setDeploying(streamIsForThisRange)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRangeId, rangeCtxLoading])

  // ── Detect an in-progress deploy when range data first loads ───────────────
  // Fires when:
  //  • selectedRangeId changes (user switches range)
  //  • rangeCtxLoading toggles
  //  • Real data for the CURRENT range arrives for the first time
  //
  // The rangeDataId dep handles the case where we navigate to dashboard right
  // after deploying a new range: selectedRangeId is set immediately, but the
  // rangeStatus query is still in-flight. When the data arrives (changing
  // rangeDataId from undefined → the range ID), the effect re-fires and finds
  // rangeState === "DEPLOYING", starting the log stream automatically.
  //
  // isPlaceholderData guard prevents the previous range's stale data (shown
  // during key transition via keepPreviousData) from triggering a false positive.
  const streamIsForThisRange = isStreaming && streamingRangeId === (selectedRangeId ?? null)
  const rangeDataId = !isPlaceholderData ? (rangeData?.rangeID ?? rangeData?.name ?? null) : null
  // Must depend on range state, not only range id: first fetch after redirect can still
  // show READY; when Ludus flips to DEPLOYING the id is unchanged — without this dep the
  // effect never re-runs and logs/stream never start until a full remount/refresh.
  const rangeStateForStream = !isPlaceholderData ? (rangeData?.rangeState ?? null) : null
  useEffect(() => {
    if (!rangeData || isPlaceholderData || rangeCtxLoading || hasNoRanges) return
    const deployingLike =
      rangeData.rangeState === "DEPLOYING" || rangeData.rangeState === "WAITING"
    // Suppress auto-restart of "Deploying…" + deploy-log stream during the
    // post-abort grace window. Ludus takes several seconds (sometimes longer)
    // to flip rangeState out of DEPLOYING after accepting an abort; without
    // this guard the UI flips right back to deploy-active and looks like the
    // abort silently failed.
    if (deployingLike && !isRangeAborting(selectedRangeId)) {
      setDeploying(true)
      setShowLogs(true)
      if (!streamIsForThisRange) startStreaming(selectedRangeId ?? undefined)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRangeId, rangeCtxLoading, rangeDataId, rangeStateForStream])

  // Once Ludus actually transitions out of DEPLOYING (or the range changes),
  // clear the optimistic aborting marker so a future legitimate deploy isn't
  // shadowed by a stale flag.
  useEffect(() => {
    if (!selectedRangeId) return
    const state = rangeStateForStream
    if (state && state !== "DEPLOYING" && state !== "WAITING") {
      clearRangeAborting(selectedRangeId)
    }
  }, [selectedRangeId, rangeStateForStream])

  // Poll rangeStatus aggressively during the aborting grace window so the
  // "Aborting…" label flips to the final state as soon as Ludus catches up,
  // instead of waiting up to 15s for the normal refetchInterval.
  useEffect(() => {
    if (!aborting || !selectedRangeId) return
    const id = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(selectedRangeId) })
    }, 2000)
    return () => clearInterval(id)
  }, [aborting, selectedRangeId, queryClient])

  // ── Stream completion → refresh data and hide logs ─────────────────────────
  useEffect(() => {
    if (!isStreaming && streamRangeState && streamRangeState !== "DEPLOYING" && streamRangeState !== "WAITING") {
      setDeploying(false)
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(selectedRangeId) })
      setTimeout(() => setShowLogs(false), 5000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, streamRangeState])

  const invalidateRangeStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(selectedRangeId) })
  }, [queryClient, selectedRangeId])

  const dashboardRefreshing = rangeCtxLoading || rangesFetching || isFetching

  const handleRefreshDashboard = useCallback(async () => {
    await refreshRanges()
    await refetchRangeStatus()
  }, [refreshRanges, refetchRangeStatus])

  // ── Deploy actions ──────────────────────────────────────────────────────────
  const doDeploy = async () => {
    clearLogs()
    setShowLogs(true)
    setDeploying(true)
    const result = await ludusApi.deployRange(undefined, undefined, selectedRangeId ?? undefined)
    if (result.error) {
      toast({ variant: "destructive", title: "Deploy failed", description: result.error })
      setDeploying(false)
      return
    }
    toast({ title: "Deploy started" })
    startStreaming(selectedRangeId ?? undefined)
  }
  const handleDeploy = () => confirm("Start range deployment?", doDeploy)

  const doAbort = async () => {
    if (!selectedRangeId) {
      toast({ variant: "destructive", title: "No range selected", description: "Select a range before aborting." })
      return
    }
    // Tear down the deploy-log stream + local deploying flag immediately so
    // the UI doesn't bounce between "Deploying…" and "Aborting…" while the
    // server-side abort is in flight. The `useAbortRange` hook handles
    // `markRangeAborting`, impersonation, toast, and query invalidation.
    setDeploying(false)
    stopStreaming()

    // If a GOAD task is driving this deploy, pass its ids so the server kills
    // the SSH/ansible process before asking Ludus to abort. For plain Ludus
    // ranges both values are null and the server skips the GOAD kill step.
    await abortRange({
      rangeId: selectedRangeId,
      goadInstanceId: goadInstanceForRange,
      goadTaskId: activeGoadTask?.id ?? null,
    })
  }
  const handleAbort = () => confirm("Abort the running deployment?", doAbort)

  const doDeleteRange = async (rangeId: string, _vmCount: number, ipsForKnownHosts?: string[]) => {
    setDeletingRangeId(rangeId)
    try {
      const result = await ludusApi.deleteRange(rangeId)
      if (result.error) {
        toast({ variant: "destructive", title: "Delete failed", description: result.error })
        return
      }

      if (ipsForKnownHosts && ipsForKnownHosts.length > 0) {
        void pruneKnownHosts(ipsForKnownHosts)
      }

      // ── GOAD workspace cleanup ──────────────────────────────────────────────
      try {
        const instRes = await fetch("/api/goad/instances")
        if (instRes.ok) {
          const instData = await instRes.json()
          const instances: { instanceId: string; ludusRangeId?: string }[] = instData.instances ?? []
          const associated = instances.filter((i) => i.ludusRangeId === rangeId)
          await Promise.all(
            associated.map((inst) =>
              fetch(`/api/goad/instances/${encodeURIComponent(inst.instanceId)}/force-delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ludusRangeId: rangeId, skipRangeDeletion: true }),
              }).catch(() => {})
            )
          )
        }
      } catch {
        // Non-fatal
      }

      toast({ title: "Range deleted", description: `${rangeId} has been permanently removed` })

      // Remove stale cache entry immediately so the UI shows nothing while the
      // context picks the next range.
      queryClient.removeQueries({ queryKey: queryKeys.rangeStatus(rangeId) })

      await refreshRanges()

      if (rangeId === selectedRangeId) {
        const remaining = accessibleRanges.filter((r) => r.rangeID !== rangeId)
        if (remaining.length > 0) selectRange(remaining[0].rangeID)
      }
    } finally {
      setDeletingRangeId(null)
    }
  }
  const handleDeleteRange = (
    rangeId: string,
    rangeName: string,
    vmCount: number,
    ipsForKnownHosts?: string[],
  ) =>
    confirm(
      [
        `Permanently DELETE range "${rangeName}"?`,
        "",
        `This will:`,
        `  • Power off and destroy all ${vmCount} VM${vmCount !== 1 ? "s" : ""}`,
        `  • Remove the Proxmox pool "${rangeId}"`,
        `  • Remove the range record from the database`,
        "",
        `This CANNOT be undone.`,
      ].join("\n"),
      () => doDeleteRange(rangeId, vmCount, ipsForKnownHosts),
    )

  const doPowerAll = async (action: "on" | "off") => {
    const vms = rangeData?.VMs || (rangeData as (RangeObject & { vms?: VMObject[] }) | null)?.vms || []
    const vmNames = vms.map((v: VMObject) => v.name || `vm-${v.ID}`).filter(Boolean)
    if (vmNames.length === 0) {
      toast({ variant: "destructive", title: "No VMs", description: "No VMs in this range to power " + action })
      return
    }
    const result = action === "on"
      ? await ludusApi.powerOn(vmNames, selectedRangeId ?? undefined)
      : await ludusApi.powerOff(vmNames, selectedRangeId ?? undefined)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: `Powering ${action} all VMs`, description: `${vmNames.length} VMs targeted` })
      setTimeout(invalidateRangeStatus, 3000)
    }
  }
  const handlePowerAll = (action: "on" | "off") =>
    confirm(
      action === "on" ? `Power ON all VMs in this range?` : `Power OFF all VMs in this range?`,
      () => doPowerAll(action)
    )

  // ── Range extras ────────────────────────────────────────────────────────────
  const extractText = (data: unknown) => {
    if (data == null) return ""
    if (typeof data === "string") return data
    if (typeof data !== "object") return String(data)
    const d = data as { result?: unknown }
    if (typeof d.result === "string") return d.result
    if (d.result != null && typeof d.result === "object") {
      try {
        return JSON.stringify(d.result, null, 2)
      } catch {
        return String(d.result)
      }
    }
    // Ludus may return inventory as a plain object (no `result` wrapper)
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return String(data)
    }
  }

  const handleDownloadOwnWireguard = async () => {
    setWireguardDownloading(true)
    try {
      const result = await ludusApi.getUserWireguard()
      if (result.error) {
        toast({ variant: "destructive", title: "WireGuard", description: result.error })
        return
      }
      const data = result.data as { result?: { wireGuardConfig?: string } } | string
      const content =
        typeof data === "string"
          ? data
          : (data as { result?: { wireGuardConfig?: string } })?.result?.wireGuardConfig || ""
      if (!content.trim()) {
        toast({ variant: "destructive", title: "WireGuard", description: "Empty configuration from server" })
        return
      }
      const blob = new Blob([content], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "ludus-wireguard.conf"
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: "WireGuard config downloaded" })
    } finally {
      setWireguardDownloading(false)
    }
  }

  const downloadText = (text: string, filename: string) => {
    const blob = new Blob([text], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Console actions ─────────────────────────────────────────────────────────
  const vmName = (vm: VMObject) => vm.name || `vm-${vm.ID}`
  const vmId = (vm: VMObject) => vm.proxmoxID || vm.ID

  const handleDownloadVv = async (vm: VMObject) => {
    const name = vmName(vm)
    const id = vmId(vm)
    if (!id) { toast({ variant: "destructive", title: "No VM ID" }); return }
    setDownloadingVm(name)
    try {
      const res = await fetch(`/api/console/spice?vmId=${id}&vmName=${encodeURIComponent(name)}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = `${name.replace(/[^a-zA-Z0-9._-]/g, "_")}.vv`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast({ title: "Downloaded", description: `Open ${name}.vv with virt-viewer` })
    } catch (err) {
      toast({ variant: "destructive", title: "Console failed", description: (err as Error).message })
    } finally {
      setDownloadingVm(null)
    }
  }

  const handleOpenBrowser = (vm: VMObject) => {
    const name = vmName(vm)
    const id = vmId(vm)
    if (!id) { toast({ variant: "destructive", title: "No VM ID" }); return }
    router.push(`/console?vmId=${id}&vmName=${encodeURIComponent(name)}`)
  }

  const handleOpenBrowserNewWindow = (vm: VMObject) => {
    const name = vmName(vm)
    const id = vmId(vm)
    if (!id) { toast({ variant: "destructive", title: "No VM ID" }); return }
    window.open(`/console?vmId=${id}&vmName=${encodeURIComponent(name)}`, "_blank", "noopener,noreferrer")
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const primaryRange = rangeData ?? null
  const allVMs = primaryRange?.VMs || (primaryRange as (RangeObject & { vms?: VMObject[] }) | null)?.vms || []

  const handleShowInventory = async (rangeIdFromCard?: string) => {
    const rid = (rangeIdFromCard || selectedRangeId || "").trim()
    if (!rid) {
      toast({ variant: "destructive", title: "No range selected", description: "Select a range in the sidebar first." })
      return
    }
    const label =
      (primaryRange?.rangeID === rid ? (primaryRange.name || primaryRange.rangeID) : null) ||
      accessibleRanges.find((r) => r.rangeID === rid)?.rangeID ||
      rid
    const labelStr = String(label)
    const cached = inventoryCacheRef.current.get(rid)
    if (cached && Date.now() - cached.at < INVENTORY_CACHE_MS) {
      setInventoryDialog({ rangeId: rid, label: labelStr, text: cached.text })
      return
    }
    setInventoryDialog({ rangeId: rid, label: labelStr, text: "" })
    setInventoryLoading(true)
    try {
      const result = await ludusApi.getRangeAnsibleInventory(rid)
      if (result.error) {
        setInventoryDialog(null)
        toast({ variant: "destructive", title: "Inventory", description: result.error })
        return
      }
      const text = extractText(result.data)
      inventoryCacheRef.current.set(rid, { text, at: Date.now() })
      setInventoryDialog({ rangeId: rid, label: labelStr, text })
      if (!text.trim()) {
        toast({ title: "Inventory", description: "Server returned an empty inventory for this range." })
      }
    } catch (err) {
      setInventoryDialog(null)
      toast({
        variant: "destructive",
        title: "Inventory",
        description: err instanceof Error ? err.message : "Request failed",
      })
    } finally {
      setInventoryLoading(false)
    }
  }
  const runningVMs = allVMs.filter((v) => v.poweredOn || v.powerState === "running").length
  const rangeState = primaryRange?.rangeState || "NEVER DEPLOYED"
  const error = rangeError ? (rangeError as Error).message : null

  const toggleRange = (id: string) => {
    setExpandedRanges((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Use ranges array for the accordion (single range from the query)
  const ranges = primaryRange ? [primaryRange] : []

  const selectedDeployHistoryEntry = deployHistorySelectedId
    ? (() => {
        const row = correlateHistoryEntries(deployHistoryEntries, goadTasksForRange ?? []).find(
          (c) =>
            c.deployEntry?.id === deployHistorySelectedId ||
            c.mergedBatchDeploys?.some((d) => d.id === deployHistorySelectedId),
        )
        if (row?.mergedBatchDeploys?.length) {
          const status = aggregateDeployStatuses(row.mergedBatchDeploys)
          return { status, id: row.deployEntry!.id } as LogHistoryEntry
        }
        return deployHistoryEntries.find((e) => e.id === deployHistorySelectedId)
      })()
    : undefined

  // Any GOAD task still running on this range's instance. Drives the header
  // badge + in-card banner; refreshed every 3s by the polling query above.
  const activeGoadTask = (goadTasksForRange ?? []).find((t) => t.status === "running") ?? null
  const activeGoadKind = activeGoadTask ? goadTaskShortKind(activeGoadTask.command) : null

  const [extInstallQueue, setExtInstallQueue] = useState<LuxExtInstallQueuePayload | null>(null)
  useEffect(() => {
    if (!selectedRangeId) {
      setExtInstallQueue(null)
      return
    }
    const read = () => {
      try {
        const raw = sessionStorage.getItem(luxExtInstallQueueStorageKey(selectedRangeId))
        setExtInstallQueue(raw ? (JSON.parse(raw) as LuxExtInstallQueuePayload) : null)
      } catch {
        setExtInstallQueue(null)
      }
    }
    read()
    const on = () => read()
    window.addEventListener(LUX_EXT_INSTALL_QUEUE_EVENT, on)
    window.addEventListener("storage", on)
    const id = setInterval(read, 2000)
    return () => {
      window.removeEventListener(LUX_EXT_INSTALL_QUEUE_EVENT, on)
      window.removeEventListener("storage", on)
      clearInterval(id)
    }
  }, [selectedRangeId])

  // When a running GOAD task ends, refetch range status + deploy history + tasks
  // so the banner disappears immediately and any range-state changes GOAD made
  // (new IPs, fresh extensions) show up without a manual refresh.
  const prevActiveTaskIdRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevActiveTaskIdRef.current
    const curr = activeGoadTask?.id ?? null
    if (prev && !curr) {
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.goadTasks() })
    }
    prevActiveTaskIdRef.current = curr
  }, [activeGoadTask?.id, selectedRangeId, queryClient])

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {error.includes("Connection failed")
              ? "Cannot connect to Ludus server. Check your LUDUS_URL and LUDUS_API_KEY settings."
              : error}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Range State" icon={<Activity className="h-4 w-4 text-primary" />}
          value={isLoading
            ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            : <Badge className={cn("text-xs", getRangeStateBadge(rangeState))}>{rangeState}</Badge>}
        />
        <StatCard title="Total VMs" icon={<Server className="h-4 w-4 text-blue-400" />}
          value={isLoading ? "—" : String(allVMs.length)} />
        <StatCard title="Running" icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
          value={isLoading ? "—" : String(runningVMs)}
          subtext={allVMs.length > 0 ? `${Math.round((runningVMs / allVMs.length) * 100)}% online` : undefined}
        />
        <StatCard title="Ludus Version" icon={<Layers className="h-4 w-4 text-cyan-400" />}
          value={isLoading ? "—" : (version ? (version.split(" ").pop() || "—") : "—")}
          subtext={version ? version.replace(/\s+\S+$/, "") : "Not connected"}
        />
      </div>

      {/* ── WireGuard — account-wide VPN (same profile for all accessible ranges) ── */}
      <Card className="border-blue-500/25 bg-blue-500/[0.06]">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Wifi className="h-4 w-4 text-blue-400 shrink-0" />
              WireGuard VPN
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Download the client configuration for your current Ludus account (including impersonation). One tunnel covers
              lab access; ranges you can use in this app
              {accessibleRanges.length > 0 ? (
                <>
                  :{" "}
                  <span className="font-mono text-foreground/85 break-all">
                    {accessibleRanges.map((r) => r.rangeID).join(", ")}
                  </span>
                </>
              ) : (
                <> are listed here once you have access — deploy or get shared access if you see none.</>
              )}
            </p>
          </div>
          <Button
            className="gap-2 shrink-0 bg-blue-600 hover:bg-blue-600/90 text-white"
            disabled={wireguardDownloading}
            onClick={() => void handleDownloadOwnWireguard()}
          >
            {wireguardDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download WireGuard
          </Button>
        </CardContent>
      </Card>

      {/* ── Range accordions ──────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : ranges.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <Server className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No ranges available yet.</p>
            <Link href="/range/new">
              <Button className="gap-1.5">
                <Play className="h-3.5 w-3.5" /> Deploy a New Range
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        ranges.map((range, idx) => {
          const rangeKey = range.rangeID || range.name || `range-${idx}`
          const isExpanded = expandedRanges.has(rangeKey)
          const vms = range.VMs || (range as RangeObject & { vms?: VMObject[] }).vms || []
          const running = vms.filter((v) => v.poweredOn || v.powerState === "running").length
          const state = range.rangeState || "NEVER DEPLOYED"

          return (
            <Card key={rangeKey} className="overflow-hidden">
              {/* ── Accordion header ──────────────────────────────────────── */}
              <button
                className="w-full text-left"
                onClick={() => toggleRange(rangeKey)}
              >
                <CardHeader className="pb-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <Server className="h-4 w-4 text-primary" />
                      <CardTitle className="text-sm font-semibold">
                        {range.name || range.rangeID || `Range ${range.rangeNumber ?? idx + 1}`}
                      </CardTitle>
                      {range.rangeNumber != null && (
                        <span className="text-xs text-muted-foreground font-mono">#{range.rangeNumber}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        <span className="text-green-400 font-medium">{running}</span>
                        <span> / {vms.length} running</span>
                      </span>
                      <Badge className={cn("text-xs", getRangeStateBadge(state))}>{state}</Badge>
                      {activeGoadTask && (
                        <Badge
                          variant="warning"
                          className="text-xs gap-1 animate-pulse"
                          title={`GOAD task ${activeGoadTask.id} is still running`}
                        >
                          <Puzzle className="h-3 w-3" />
                          GOAD: {activeGoadKind}
                        </Badge>
                      )}
                      {rangeDataUpdatedAt > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Wifi className={cn("h-3 w-3", dashboardRefreshing ? "text-yellow-400 animate-pulse" : "text-green-400")} />
                          {new Date(rangeDataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </button>

              {isExpanded && (
                <CardContent className="pt-0 space-y-4">
                  {/* ── Action bar ──────────────────────────────────────── */}
                  <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      onClick={handleDeploy}
                      disabled={deploying || state === "DEPLOYING" || aborting || !!pendingAction}
                      className="gap-1.5"
                    >
                      {aborting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : deploying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {aborting ? "Aborting…" : deploying ? "Deploying…" : "Deploy"}
                    </Button>
                    {/* While in the optimistic aborting window we replace the
                        Abort button with a disabled spinner so the user doesn't
                        click it a second time thinking the first click did
                        nothing. Show the real Abort button only once aborting
                        has expired AND Ludus still reports DEPLOYING. */}
                    {aborting ? (
                      <Button variant="destructive" disabled className="gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Aborting…
                      </Button>
                    ) : (
                      (deploying || state === "DEPLOYING") && (
                        <Button
                          variant="destructive"
                          onClick={handleAbort}
                          disabled={!!pendingAction}
                          className="gap-1.5"
                        >
                          <StopCircle className="h-3.5 w-3.5" /> Abort
                        </Button>
                      )
                    )}
                    <Button variant="outline" onClick={() => handlePowerAll("on")} disabled={!!pendingAction} className="gap-1.5">
                      <Power className="h-3.5 w-3.5 text-green-400" /> All On
                    </Button>
                    <Button variant="outline" onClick={() => handlePowerAll("off")} disabled={!!pendingAction} className="gap-1.5">
                      <PowerOff className="h-3.5 w-3.5 text-red-400" /> All Off
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleShowInventory(range.rangeID || rangeKey)}
                      disabled={inventoryLoading}
                      className="gap-1.5"
                    >
                      {inventoryLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <List className="h-3.5 w-3.5" />
                      )}{" "}
                      Inventory
                    </Button>
                    <Link href="/range/config">
                      <Button variant="ghost" className="gap-1.5">
                        <FileCode2 className="h-3.5 w-3.5" /> Config & Deploy
                      </Button>
                    </Link>
                    {/* GOAD-managed ranges have lifecycle actions (install
                        extension, provision lab, provide) that only exist on
                        the GOAD instance page — jump straight there so users
                        don't have to hunt for it in the sidebar. */}
                    {goadInstanceForRange && (
                      <Link href={`/goad/${encodeURIComponent(goadInstanceForRange)}`}>
                        <Button
                          variant="outline"
                          className="gap-1.5 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                        >
                          <Puzzle className="h-3.5 w-3.5" /> GOAD Instance
                        </Button>
                      </Link>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleRefreshDashboard()}
                      disabled={dashboardRefreshing}
                      className="ml-auto"
                    >
                      <RefreshCw className={cn("h-4 w-4", dashboardRefreshing && "animate-spin")} />
                    </Button>
                    {range.testingEnabled && (
                      <Badge variant="warning" className="flex items-center gap-1 px-3 py-1.5">
                        <Shield className="h-3 w-3" /> Testing Mode
                      </Badge>
                    )}
                    {/* Destructive zone — separated to avoid accidental clicks */}
                    <div className="w-px h-6 bg-border/60 mx-1 self-center" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-red-400/70 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/30"
                      disabled={!!pendingAction || state === "DEPLOYING" || !!deletingRangeId}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteRange(
                          range.rangeID || rangeKey,
                          range.name || range.rangeID || rangeKey,
                          vms.length,
                          vms.map((v) => v.ip).filter((ip) => typeof ip === "string" && ip.trim() !== ""),
                        )
                      }}
                    >
                      {deletingRangeId === (range.rangeID || rangeKey) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {deletingRangeId === (range.rangeID || rangeKey) ? "Deleting…" : "Delete Range"}
                    </Button>
                  </div>

                  {/* ── GOAD provisioning banner ────────────────────────── */}
                  {extInstallQueue && extInstallQueue.names.length > 1 && (
                    <Alert className="border-blue-500/30 bg-blue-500/[0.06]">
                      <Puzzle className="h-4 w-4 text-blue-400" />
                      <AlertDescription className="text-xs space-y-1">
                        <p className="font-medium">
                          Extension install queue ({extInstallQueue.total ?? extInstallQueue.names.length}{" "}
                          total)
                        </p>
                        <p className="font-mono text-[11px] leading-relaxed break-all">
                          {extInstallQueue.names.join(" → ")}
                        </p>
                        {extInstallQueue.current != null && extInstallQueue.index != null ? (
                          <p className="text-muted-foreground">
                            Now: {extInstallQueue.current} ({extInstallQueue.index}/
                            {extInstallQueue.total ?? extInstallQueue.names.length})
                          </p>
                        ) : null}
                      </AlertDescription>
                    </Alert>
                  )}
                  {/* Ludus range state can flip to SUCCESS while the GOAD container is still
                      running Ansible for provide / install-extension / provision-lab. Surface
                      that here so users don't have to open the GOAD instance to notice. */}
                  {activeGoadTask && goadInstanceForRange && (() => {
                    const rangeStillDeploying =
                      state === "DEPLOYING" ||
                      state === "WAITING" ||
                      deploying ||
                      isStreaming
                    // Both can run concurrently (GOAD drives Ludus deploy through
                    // ansible-playbook while also applying its own roles). Pick the
                    // accurate phrasing based on live Ludus range state.
                    const headline = rangeStillDeploying
                      ? `GOAD action is running (${activeGoadKind}). The Ludus range deploy is also still in progress.`
                      : `GOAD action is still running (${activeGoadKind}). The Ludus range deploy has finished; the GOAD container is still applying Ansible.`
                    return (
                      <Alert className="border-amber-500/30 bg-amber-500/[0.06]">
                        <Puzzle className="h-4 w-4 text-amber-400" />
                        <AlertDescription className="flex items-center justify-between gap-3">
                          <div className="min-w-0 space-y-0.5">
                            <p className="text-xs font-medium">{headline}</p>
                            <p className="text-[11px] text-muted-foreground">
                              Started {timeAgo(activeGoadTask.startedAt)}
                              {" · "}
                              {activeGoadTask.lineCount.toLocaleString()} log lines
                              {" · "}
                              <span className="font-mono">{activeGoadTask.id}</span>
                            </p>
                          </div>
                          <Link
                            href={`/goad/${encodeURIComponent(goadInstanceForRange)}?tab=deploy`}
                            className="shrink-0"
                          >
                            <Button size="sm" variant="outline" className="gap-1.5">
                              <ExternalLink className="h-3 w-3" /> Open GOAD
                            </Button>
                          </Link>
                        </AlertDescription>
                      </Alert>
                    )
                  })()}

                  {/* ── Deploy logs ─────────────────────────────────────── */}
                  {showLogs && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          <Activity className={cn("h-3.5 w-3.5", isStreaming && "animate-pulse text-green-400")} />
                          Deploy Logs
                          {isStreaming && <Badge variant="success" className="text-xs">Live</Badge>}
                        </h4>
                        <Button size="sm" variant="ghost" onClick={() => setShowLogs(false)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <LogViewer lines={logLines} onClear={clearLogs} maxHeight="300px" />
                    </div>
                  )}

                  {/* ── Deploy history (collapsible; default closed, like Templates Build History) ─ */}
                  <div className="rounded-md border border-border/60 bg-muted/15 overflow-hidden">
                    <div className="flex items-stretch min-h-[2.5rem] border-b border-border/40">
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left px-3 py-2.5 hover:bg-muted/25 transition-colors"
                        onClick={() => setDeployHistoryOpen((o) => !o)}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {deployHistoryOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <History className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Deploy History
                          </span>
                          {deployHistoryEntries.length > 0 && (
                            <Badge variant="secondary" className="text-[10px]">{deployHistoryEntries.length}</Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground font-normal normal-case tracking-normal">
                            — past range deploys
                          </span>
                        </div>
                      </button>
                      <div className="flex items-center px-2 shrink-0 border-l border-border/40 bg-muted/10">
                        <Link href="/logs" className="text-[10px] text-primary hover:underline whitespace-nowrap py-2">
                          Range Logs
                        </Link>
                      </div>
                    </div>
                    {deployHistoryOpen && (
                      <div className="p-3 space-y-2">
                        {deployHistorySelectedId ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={clearDeployHistorySelection}>
                                <ArrowLeft className="h-3 w-3" /> Back
                              </Button>
                              {selectedDeployHistoryEntry && (
                                <Badge
                                  variant={
                                    selectedDeployHistoryEntry.status.toLowerCase() === "success"
                                      ? "success"
                                      : selectedDeployHistoryEntry.status.toLowerCase() === "running"
                                        ? "warning"
                                        : "destructive"
                                  }
                                  className="text-xs capitalize"
                                >
                                  {selectedDeployHistoryEntry.status}
                                </Badge>
                              )}
                            </div>
                            {deployHistoryDetailLoading ? (
                              <div className="flex justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                              </div>
                            ) : (
                              <LogViewer lines={deployHistoryLines} autoScroll={false} maxHeight="280px" />
                            )}
                          </div>
                        ) : (
                          <PaginatedLogHistoryList
                            paginationResetKey={selectedRangeId ?? ""}
                            allEntries={deployHistoryEntries}
                            loading={deployHistoryListLoading}
                            onSelect={handleSelectDeployHistory}
                            selectedId={deployHistorySelectedId}
                            goadInstanceId={goadInstanceForRange}
                            goadTasks={
                              goadInstanceForRange
                                ? goadTasksListLoading
                                  ? undefined
                                  : (goadTasksForRange ?? [])
                                : undefined
                            }
                            onRefresh={() => {
                              void queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(selectedRangeId) })
                              void queryClient.invalidateQueries({ queryKey: queryKeys.goadTasks() })
                            }}
                            refreshing={deployHistoryRefreshing || (!!goadInstanceForRange && goadTasksListLoading)}
                            emptyMessage="No deploy history for this range"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── VM operation audit log (collapsible, mirrors Deploy History) ── */}
                  {/* LUX-local SQLite trail for per-VM destroys and GOAD extension removals.
                      Visible here because the destroy actions originate from this page and
                      from GOAD — users were missing them entirely otherwise. */}
                  <div className="rounded-md border border-border/60 bg-muted/15 overflow-hidden">
                    <div className="flex items-stretch min-h-[2.5rem] border-b border-border/40">
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left px-3 py-2.5 hover:bg-muted/25 transition-colors"
                        onClick={() => setVmOperationLogOpen((o) => !o)}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {vmOperationLogOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            VM Operations
                          </span>
                          {vmOperationEntries.length > 0 && (
                            <Badge variant="secondary" className="text-[10px]">{vmOperationEntries.length}</Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground font-normal normal-case tracking-normal">
                            — VM destroys &amp; GOAD extension removals
                          </span>
                        </div>
                      </button>
                      <div className="flex items-center px-2 shrink-0 border-l border-border/40 bg-muted/10">
                        <Link href="/logs" className="text-[10px] text-primary hover:underline whitespace-nowrap py-2">
                          Range Logs
                        </Link>
                      </div>
                    </div>
                    {vmOperationLogOpen && (
                      <div className="p-3">
                        <VmOperationLogList
                          entries={vmOperationEntries}
                          loading={vmOperationLoading}
                          refreshing={vmOperationRefreshing}
                          paginationResetKey={selectedRangeId ?? ""}
                          onRefresh={() =>
                            void queryClient.invalidateQueries({
                              queryKey: queryKeys.vmOperationLog(selectedRangeId),
                            })
                          }
                          emptyMessage="No VM destroys or extension removals recorded for this range"
                        />
                      </div>
                    )}
                  </div>

                  {!showLogs && (deploying || state === "DEPLOYING") && (
                    <Button size="sm" variant="ghost" onClick={() => setShowLogs(true)} className="gap-1.5 text-xs">
                      <Activity className="h-3.5 w-3.5 animate-pulse text-green-400" />
                      Show deploy logs
                    </Button>
                  )}

                  {/* ── VM table with console actions ────────────────────── */}
                  <VMTable
                    vms={vms}
                    rangeId={selectedRangeId ?? undefined}
                    onRefresh={() => void handleRefreshDashboard()}
                    onDownloadVv={handleDownloadVv}
                    onOpenBrowser={handleOpenBrowser}
                    onOpenBrowserNewWindow={handleOpenBrowserNewWindow}
                    downloadingVm={downloadingVm}
                    openingVm={openingVm}
                  />
                </CardContent>
              )}
            </Card>
          )
        })
      )}

      <Dialog
        open={!!inventoryDialog}
        onOpenChange={(open) => {
          if (!open) {
            setInventoryDialog(null)
            setInventoryLoading(false)
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              Ansible inventory — {inventoryDialog?.label ?? ""}
            </DialogTitle>
          </DialogHeader>
          {inventoryLoading ? (
            <div className="mt-2 mb-4 flex min-h-[200px] max-h-[60vh] flex-col items-center justify-center gap-3 rounded-md border border-border bg-black/40 p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p>Fetching inventory from Ludus…</p>
              <p className="text-xs max-w-sm">
                Generating inventory on the server is often slow. Re-opening the same range within a few minutes uses a
                local cache so it appears instantly.
              </p>
            </div>
          ) : (
            <pre className="mt-2 mb-4 flex-1 min-h-[200px] max-h-[60vh] overflow-auto rounded-md border border-border bg-black/60 p-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
              {inventoryDialog?.text?.trim()
                ? inventoryDialog.text
                : "(empty — Ludus returned no inventory text for this range)"}
            </pre>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={inventoryLoading || !inventoryDialog?.text?.trim()}
              onClick={() =>
                inventoryDialog?.text &&
                downloadText(
                  inventoryDialog.text,
                  `${inventoryDialog.rangeId.replace(/[^a-zA-Z0-9._-]/g, "_")}-inventory.txt`,
                )
              }
            >
              <Download className="h-4 w-4" /> Download
            </Button>
            <Button variant="ghost" onClick={() => setInventoryDialog(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({
  title, value, icon, subtext,
}: {
  title: string
  value: React.ReactNode
  icon: React.ReactNode
  subtext?: string
}) {
  return (
    <Card className="glass-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">{title}</span>
          {icon}
        </div>
        <div className="text-xl font-bold">{value}</div>
        {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
      </CardContent>
    </Card>
  )
}
