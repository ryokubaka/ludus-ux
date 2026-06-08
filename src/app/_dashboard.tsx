"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import { timeAgo, cn, extractArray, getRangeStateBadge } from "@/lib/utils"
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
  Check,
  Loader2,
  Wifi,
  ChevronDown,
  ChevronRight,
  List,
  FileCode2,
  Download,
  X,
  Trash2,
  ServerOff,
  History,
  ArrowLeft,
  Puzzle,
  ExternalLink,
  ShieldAlert,
} from "lucide-react"
import { ludusApi, getImpersonationHeaders, getVmOperationLog, postVmOperationAudit, pruneKnownHosts, cleanupGoadWorkspaceAfterRangeDelete } from "@/lib/api"
import {
  goadTaskShortKind,
  correlateHistoryEntries,
  aggregateDeployStatuses,
  type GoadTaskForCorrelation,
} from "@/lib/goad-deploy-history-correlation"
import { useRange } from "@/lib/range-context"
import type { RangeObject, VMObject, LogHistoryEntry } from "@/lib/types"
import type { RangeLogMarkerEnrichment } from "@/lib/range-log-marker-types"
import { useToast } from "@/hooks/use-toast"
import { useDeployLogContext } from "@/lib/deploy-log-context"
import { useElapsed } from "@/hooks/use-elapsed"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { queryKeys } from "@/lib/query-keys"
import { tryToastLudusSlowHttpError } from "@/lib/ludus-timeout-ui"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { STALE } from "@/lib/query-client"
import { augmentLudusDeployHistoryLines } from "@/lib/log-line-timestamp"
import { fetchGoadTaskLogLines } from "@/lib/goad-task-lines"
import { fetchDeployElapsedAnchorMs } from "@/lib/range-deploy-elapsed-anchor"
import {
  clearRangeAborting,
  isRangeAborting,
} from "@/lib/range-aborting"
import { useAbortRange } from "@/lib/use-abort-range"
import { IMPERSONATION_CHANGED_EVENT } from "@/lib/impersonation-context"
import {
  pickNetworkFollowupDeployRow,
  isDeployHistoryRunning,
} from "@/lib/wait-lux-network-tag-deploy"
import {
  clearVmPartialListStreak,
  dedupeVMs,
  resolveVmListForRangeQuery,
  vmIsRunning,
} from "@/lib/dashboard-vm-merge"
import { waitForVmPowerConfirmation } from "@/lib/wait-for-vm-power-state"

/** Re-open inventory for the same range without waiting on Ludus again. */
const INVENTORY_CACHE_MS = 3 * 60 * 1000

export function DashboardPageClient() {
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const {
    selectedRangeId,
    ranges: accessibleRanges,
    loading: rangeCtxLoading,
    rangesFetching,
    selectRange,
    refreshRanges,
  } = useRange()
  const scopeTag = useEffectiveScopeTag()

  useEffect(() => {
    clearVmPartialListStreak()
  }, [selectedRangeId, scopeTag])

  const { abortRange } = useAbortRange(scopeTag)

  const hasNoRanges = !rangeCtxLoading && accessibleRanges.length === 0 && !selectedRangeId

  // ── UI state ────────────────────────────────────────────────────────────────
  const [wireguardDownloading, setWireguardDownloading] = useState(false)
  /** Modal inventory — same path as before: client → /api/proxy → Ludus (impersonation headers on every ludusApi call). */
  const [inventoryDialog, setInventoryDialog] = useState<{ rangeId: string; label: string; text: string } | null>(null)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const inventoryCacheRef = useRef(new Map<string, { text: string; at: number }>())
  useEffect(() => {
    const clearInv = () => inventoryCacheRef.current.clear()
    window.addEventListener(IMPERSONATION_CHANGED_EVENT, clearInv)
    return () => window.removeEventListener(IMPERSONATION_CHANGED_EVENT, clearInv)
  }, [])
  const [deletingRangeId, setDeletingRangeId] = useState<string | null>(null)
  const [destroyingAllVmsRangeId, setDestroyingAllVmsRangeId] = useState<string | null>(null)
  const [powerAllPending, setPowerAllPending] = useState<"on" | "off" | null>(null)
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
  const {
    lines: logLines,
    isStreaming,
    rangeState: streamRangeState,
    activeRangeId: streamingRangeId,
    streamStartedAt,
    startStreaming,
    stopStreaming,
    clearLogs,
    refreshRangeStateFromServer,
  } = useDeployLogContext()

  const deployLogRefreshLock = useRef(false)
  const [deployLogRefreshBusy, setDeployLogRefreshBusy] = useState(false)
  const handleRefreshDeployLogs = useCallback(() => {
    const rid = selectedRangeId?.trim()
    if (!rid || deployLogRefreshLock.current) return
    deployLogRefreshLock.current = true
    setDeployLogRefreshBusy(true)
    stopStreaming()
    void (async () => {
      try {
        const anchor = await fetchDeployElapsedAnchorMs((id) => ludusApi.getRangeLogHistory(id), rid)
        startStreaming(rid, {
          snapshotStart: false,
          ...(anchor != null ? { deployElapsedAnchorMs: anchor } : {}),
        })
        void refreshRangeStateFromServer(rid)
      } finally {
        window.setTimeout(() => {
          deployLogRefreshLock.current = false
          setDeployLogRefreshBusy(false)
        }, 750)
      }
    })()
  }, [selectedRangeId, stopStreaming, startStreaming, refreshRangeStateFromServer])

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
    queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId),
    queryFn: async () => {
      const rid = selectedRangeId?.trim()
      if (!rid) return null
      const result = await ludusApi.getRangeStatus(rid)
      if (result.error) {
        // Ludus sometimes returns HTTP 400 for GET /range during deploy / log-stream
        // startup while GET /range/logs/history still succeeds (see access logs). Treat
        // as transient: keep last good snapshot or empty state instead of throwing.
        if (result.status === 400) {
          const prev = queryClient.getQueryData<RangeObject>(queryKeys.rangeStatus(scopeTag, selectedRangeId))
          return prev ?? null
        }
        throw new Error(typeof result.error === "string" ? result.error : "Failed to load range status")
      }
      if (!result.data) return null
      const data = result.data
      const rawVMs = data.VMs || (data as RangeObject & { vms?: VMObject[] }).vms || []
      const newVMs = dedupeVMs(rawVMs)

      // Ludus GET /range sometimes returns an empty or *short* VMs array on one poll (deploy,
      // Proxmox hiccup, or slow inventory). Prefer cache / numberOfVMs so refresh does not hide VMs.
      const prev = queryClient.getQueryData<RangeObject>(queryKeys.rangeStatus(scopeTag, selectedRangeId))
      const prevVMs = prev?.VMs || (prev as (RangeObject & { vms?: VMObject[] }) | undefined)?.vms || []
      const state = (data.rangeState || "").toString().toUpperCase()
      const vms = resolveVmListForRangeQuery({
        data,
        newVMs,
        prevVMs,
        stateUpper: state,
        scopeTag,
        rangeId: rid,
      })

      return { ...data, VMs: vms }
    },
    enabled: !rangeCtxLoading && !hasNoRanges && !!selectedRangeId?.trim(),
    staleTime: STALE.realtime,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
      // When switching ranges, do not show the previous range's VM table as a placeholder.
      placeholderData: (previousData, previousQuery) => {
        if (!previousData || !previousQuery) return previousData
        const pk = previousQuery.queryKey
        const ck = queryKeys.rangeStatus(scopeTag, selectedRangeId)
        if (pk[pk.length - 1] !== ck[ck.length - 1]) return undefined
        return previousData
      },
  })

  // ── Version query ───────────────────────────────────────────────────────────
  const { data: versionData } = useQuery({
    queryKey: queryKeys.version(scopeTag),
    queryFn: async () => {
      const result = await ludusApi.getVersion()
      return result.data ?? null
    },
    staleTime: STALE.long,
  })
  const version = versionData ? (versionData.result || versionData.version || "") : ""

  const { data: deployHistoryEntries = [], isLoading: deployHistoryListLoading, isFetching: deployHistoryRefreshing } =
    useQuery({
      queryKey: queryKeys.rangeLogHistory(scopeTag, selectedRangeId),
      queryFn: async () => {
        const result = await ludusApi.getRangeLogHistory(selectedRangeId ?? undefined)
        return extractArray<LogHistoryEntry>(result.data as unknown)
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
    queryKey: queryKeys.goadInstanceForRange(scopeTag, selectedRangeId ?? ""),
    queryFn: async () => {
      if (!selectedRangeId) return null
      const res = await fetch(`/api/goad/by-range?rangeId=${encodeURIComponent(selectedRangeId)}`, {
        credentials: "include",
        headers: { ...getImpersonationHeaders() },
      })
      if (!res.ok) return null
      const data = (await res.json()) as { instanceId?: string | null }
      return data.instanceId && typeof data.instanceId === "string" ? data.instanceId : null
    },
    enabled: !rangeCtxLoading && !hasNoRanges && !!selectedRangeId,
    staleTime: STALE.short,
  })

  const { data: goadTasksForRange, isLoading: goadTasksListLoading } = useQuery({
    queryKey: queryKeys.goadTasksForInstance(scopeTag, goadInstanceForRange ?? ""),
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
      const data = q.state.data ?? []
      const tasksRunning = data.some((t) => t.status === "running")
      const postGoadNetwork = data.some((t) => t.phase === "network-deploy")
      return tasksRunning || postGoadNetwork || shouldPollGoadTasksAux ? 3000 : false
    },
  })

  const { data: logMarkerEnrichment = null } = useQuery({
    queryKey: queryKeys.rangeLogEnrichment(scopeTag, selectedRangeId),
    queryFn: async (): Promise<RangeLogMarkerEnrichment | null> => {
      const rid = selectedRangeId!
      const res = await fetch(`/api/range/log-enrichment?rangeId=${encodeURIComponent(rid)}`, {
        credentials: "include",
        headers: { ...getImpersonationHeaders() },
      })
      if (!res.ok) return null
      return (await res.json()) as RangeLogMarkerEnrichment
    },
    enabled: !rangeCtxLoading && !hasNoRanges && !!selectedRangeId,
    staleTime: STALE.short,
    refetchInterval: shouldPollGoadTasksAux ? 5000 : false,
  })

  // ── VM operation audit log (destroy_vm / remove_extension) ───────────────
  // Scoped to the currently selected range; the GET route filters to the
  // effective user automatically for non-admins.
  const {
    data: vmOperationEntries = [],
    isLoading: vmOperationLoading,
    isFetching: vmOperationRefreshing,
  } = useQuery({
    queryKey: queryKeys.vmOperationLog(scopeTag, selectedRangeId),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.vmOperationLog(scopeTag, selectedRangeId) })
    window.addEventListener("vm-operation-log-updated", handler)
    return () => window.removeEventListener("vm-operation-log-updated", handler)
  }, [queryClient, selectedRangeId, scopeTag])

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
          const raw = result.data.result.split("\n").filter((l) => l.trim())
          lines.push(
            ...augmentLudusDeployHistoryLines(raw, result.data.start, result.data.end),
          )
        } else if (result.error && deployIds.length === 1) {
          toast({ variant: "destructive", title: "Failed to load log", description: result.error })
        }
      }
      if (row?.goadTask) {
        const goadLines = await fetchGoadTaskLogLines(row.goadTask.id, getImpersonationHeaders())
        if (goadLines.length > 0) {
          if (lines.length > 0) lines.push("")
          lines.push("--- GOAD ---")
          lines.push(...goadLines)
        }
      }
      setDeployHistoryLines(lines)
      setDeployHistoryDetailLoading(false)
    },
    [selectedRangeId, toast, deployHistoryEntries, goadTasksForRange],
  )

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
  // during key transition via range-scoped placeholder) from triggering a false positive.
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
      if (!streamIsForThisRange) {
        const rid = selectedRangeId?.trim()
        if (rid) {
          void (async () => {
            const anchor = await fetchDeployElapsedAnchorMs((id) => ludusApi.getRangeLogHistory(id), rid)
            startStreaming(rid, {
              snapshotStart: false,
              ...(anchor != null ? { deployElapsedAnchorMs: anchor } : {}),
            })
          })()
        } else {
          startStreaming(undefined, { snapshotStart: false })
        }
      }
    } else if (!deployingLike) {
      // Ludus GET confirms a terminal state (ERROR / SUCCESS / ABORTED / etc.).
      // Clear deploying unconditionally — this covers the case where the SSE
      // stream ended via [ERROR] line or onerror without sending a [DONE]
      // message, leaving streamRangeState null and the stream-completion effect
      // unable to fire setDeploying(false).
      setDeploying(false)
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
    }, 2000)
    return () => clearInterval(id)
  }, [aborting, selectedRangeId, queryClient])

  // ── Stream completion → refresh data and hide logs ─────────────────────────
  useEffect(() => {
    if (isStreaming) return
    // streamRangeState is set when the SSE server sends [DONE] with the final
    // state. If the stream ended via [ERROR] line or a network onerror it stays
    // null — fall back to what Ludus's GET already told us.
    const finalState = streamRangeState ?? rangeData?.rangeState ?? null
    if (finalState && finalState !== "DEPLOYING" && finalState !== "WAITING") {
      setDeploying(false)
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(scopeTag, selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogEnrichment(scopeTag, selectedRangeId) })
      setTimeout(() => setShowLogs(false), 5000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, streamRangeState])

  const invalidateRangeStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
  }, [queryClient, selectedRangeId, scopeTag])

  /** Background poll / range list fetch — status dot only, not the manual refresh control. */
  const dashboardDataSyncing = rangeCtxLoading || rangesFetching || isFetching
  const [manualDashboardRefresh, setManualDashboardRefresh] = useState(false)

  const handleRefreshDashboard = useCallback(async () => {
    setManualDashboardRefresh(true)
    try {
      await refreshRanges()
      await refetchRangeStatus()
    } finally {
      setManualDashboardRefresh(false)
    }
  }, [refreshRanges, refetchRangeStatus])

  // ── Deploy actions ──────────────────────────────────────────────────────────
  const doDeploy = async () => {
    clearLogs()
    setShowLogs(true)
    setDeploying(true)
    const result = await ludusApi.deployRange(undefined, undefined, selectedRangeId ?? undefined)
    if (result.error) {
      if (
        tryToastLudusSlowHttpError({
          toast,
          error: result.error,
          slowTitle: "Slow response from Ludus",
          onSlow: () => {
            setDeploying(false)
            void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
            void refreshRanges()
          },
        })
      ) {
        return
      }
      toast({ variant: "destructive", title: "Deploy failed", description: result.error })
      setDeploying(false)
      return
    }
    toast({ title: "Deploy started" })
    startStreaming(selectedRangeId ?? undefined, { snapshotStart: true })
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
        if (
          tryToastLudusSlowHttpError({
            toast,
            error: result.error,
            slowTitle: "Slow response from Ludus",
            onSlow: () => {
              void refreshRanges()
              void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, rangeId) })
            },
          })
        ) {
          return
        }
        toast({ variant: "destructive", title: "Delete failed", description: result.error })
        return
      }

      if (ipsForKnownHosts && ipsForKnownHosts.length > 0) {
        void pruneKnownHosts(ipsForKnownHosts)
      }

      await cleanupGoadWorkspaceAfterRangeDelete(rangeId)

      toast({ title: "Range deleted", description: `${rangeId} has been permanently removed` })

      // Remove stale cache entry immediately so the UI shows nothing while the
      // context picks the next range.
      queryClient.removeQueries({ queryKey: queryKeys.rangeStatus(scopeTag, rangeId) })

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

  const doDestroyAllVms = async (rangeId: string, ipsForKnownHosts: string[] | undefined, vmCount: number) => {
    setDestroyingAllVmsRangeId(rangeId)
    try {
      const result = await ludusApi.deleteRangeVMs(rangeId)
      if (result.error) {
        if (
          tryToastLudusSlowHttpError({
            toast,
            error: result.error,
            slowTitle: "Slow response from Ludus",
            onSlow: () => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
              void queryClient.invalidateQueries({ queryKey: queryKeys.vmOperationLog(scopeTag, selectedRangeId) })
              void refreshRanges()
            },
          })
        ) {
          return
        }
        toast({ variant: "destructive", title: "Destroy VMs failed", description: result.error })
        void postVmOperationAudit({
          kind: "destroy_vm",
          rangeId,
          instanceId: goadInstanceForRange ?? undefined,
          vmName: "All VMs in range (bulk)",
          status: "error",
          detail: result.error,
        })
        return
      }
      void postVmOperationAudit({
        kind: "destroy_vm",
        rangeId,
        instanceId: goadInstanceForRange ?? undefined,
        vmName: "All VMs in range (bulk)",
        status: "ok",
        detail: `DELETE /range/${rangeId}/vms — ${vmCount} VM${vmCount !== 1 ? "s" : ""} targeted`,
      })
      if (ipsForKnownHosts && ipsForKnownHosts.length > 0) {
        void pruneKnownHosts(ipsForKnownHosts)
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.vmOperationLog(scopeTag, selectedRangeId) })
      void refreshRanges()
      toast({
        title: "VMs destroying",
        description: "Ludus is removing all VMs in this range. The range and its config remain; you can deploy again.",
      })
      setTimeout(invalidateRangeStatus, 3000)
    } finally {
      setDestroyingAllVmsRangeId(null)
    }
  }

  const handleDestroyAllVms = (
    rangeId: string,
    rangeName: string,
    vmCount: number,
    ipsForKnownHosts?: string[],
  ) =>
    confirm(
      [
        `Destroy all VMs in range "${rangeName}"?`,
        "",
        `This will:`,
        `  • Power off and destroy all ${vmCount} VM${vmCount !== 1 ? "s" : ""}`,
        "",
        `This will NOT:`,
        `  • Remove the Ludus range or Proxmox pool "${rangeId}"`,
        `  • Delete your range-config.yml`,
        "",
        `You can deploy again afterward.`,
        "",
        `This is different from Delete Range, which also removes the pool and the range record.`,
      ].join("\n"),
      () => doDestroyAllVms(rangeId, ipsForKnownHosts, vmCount),
    )

  const doPowerAll = async (action: "on" | "off") => {
    const vms = rangeData?.VMs || (rangeData as (RangeObject & { vms?: VMObject[] }) | null)?.vms || []
    const vmNames = vms.map((v: VMObject) => v.name || v.vmName || `vm-${v.ID}`).filter(Boolean)
    if (vmNames.length === 0) {
      toast({ variant: "destructive", title: "No VMs", description: "No VMs in this range to power " + action })
      return
    }
    setPowerAllPending(action)
    let pollAfterRequest = false
    try {
      const result = action === "on"
        ? await ludusApi.powerOn(vmNames, selectedRangeId ?? undefined)
        : await ludusApi.powerOff(vmNames, selectedRangeId ?? undefined)
      if (result.error) {
        if (
          tryToastLudusSlowHttpError({
            toast,
            error: result.error,
            slowTitle: "Slow response from Ludus",
            onSlow: () => {
              void invalidateRangeStatus()
            },
          })
        ) {
          pollAfterRequest = true
        } else {
          toast({ variant: "destructive", title: "Error", description: result.error })
          return
        }
      } else {
        toast({
          title: action === "on" ? "Powering on all VMs" : "Powering off all VMs",
          description: `${vmNames.length} VMs — waiting for confirmation…`,
        })
        pollAfterRequest = true
      }

      if (pollAfterRequest) {
        void invalidateRangeStatus()
        const wait = await waitForVmPowerConfirmation({
          rangeId: selectedRangeId ?? undefined,
          vmNames,
          action,
          fetchStatus: () => ludusApi.getRangeStatus(selectedRangeId ?? undefined),
        })
        void invalidateRangeStatus()
        if (wait.ok) {
          toast({
            title: action === "on" ? "All VMs running" : "All VMs stopped",
            description: `${vmNames.length} VMs confirmed`,
          })
        } else if (wait.via === "timeout") {
          toast({
            variant: "destructive",
            title: "Power state not confirmed yet",
            description: `${wait.pending.length} VM(s) may still be ${action === "on" ? "starting" : "stopping"}. Refresh to check.`,
          })
        }
      }
    } finally {
      setPowerAllPending(null)
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
    const invKey = `${scopeTag}::${rid}`
    const cached = inventoryCacheRef.current.get(invKey)
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
      inventoryCacheRef.current.set(invKey, { text, at: Date.now() })
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
  const runningVMs = allVMs.filter(vmIsRunning).length
  const rangeState = primaryRange?.rangeState || "NEVER DEPLOYED"
  const error = rangeError ? (rangeError as Error).message : null

  // Single range card from the selected range's status query (range picker lives in the sidebar).
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
  // Most recent task (regardless of status) — used to detect post-GOAD phases.
  const latestGoadTask = (goadTasksForRange ?? [])[0] ?? null
  const goadElapsed = useElapsed(activeGoadTask ? activeGoadTask.startedAt : null)
  // Range log timer: prefer GOAD task's server-persisted startedAt over the
  // context's Date.now()-based streamStartedAt so it survives page refresh.
  const rangeElapsed = useElapsed(isStreaming ? (activeGoadTask?.startedAt ?? streamStartedAt) : null)

  // When a running GOAD task ends, refetch range status + deploy history + tasks
  // so the banner disappears immediately and any range-state changes GOAD made
  // (new IPs, fresh extensions) show up without a manual refresh.
  const prevActiveTaskIdRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevActiveTaskIdRef.current
    const curr = activeGoadTask?.id ?? null
    if (prev && !curr) {
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(scopeTag, selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogEnrichment(scopeTag, selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: [...queryKeys.goadTasks(), scopeTag], exact: false })
    }
    prevActiveTaskIdRef.current = curr
  }, [activeGoadTask?.id, selectedRangeId, queryClient, scopeTag])

  // Stale phase guard: if SQLite still says network-deploy but Ludus history
  // already shows a terminal network follow-up, clear phase so the Step 2 banner
  // does not persist (e.g. after a page refresh mid-wait or a missed poll).
  const stalePhaseClearRef = useRef<string | null>(null)
  useEffect(() => {
    const task = latestGoadTask
    if (!task || task.phase !== "network-deploy" || !task.endedAt) return
    const anchorMs = task.endedAt
    const row = pickNetworkFollowupDeployRow(deployHistoryEntries, anchorMs)
    if (!row || isDeployHistoryRunning(row.status || "")) return
    if (stalePhaseClearRef.current === task.id) return
    stalePhaseClearRef.current = task.id
    void (async () => {
      try {
        await fetch(`/api/goad/tasks/${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: null }),
        })
        await queryClient.invalidateQueries({ queryKey: [...queryKeys.goadTasks(), scopeTag], exact: false })
      } catch {
        stalePhaseClearRef.current = null
      }
    })()
  }, [latestGoadTask, deployHistoryEntries, queryClient, scopeTag])

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

      {/* ── Selected range (single card; range switcher is in the sidebar) ─── */}
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
          const vms = range.VMs || (range as RangeObject & { vms?: VMObject[] }).vms || []
          const running = vms.filter(vmIsRunning).length
          const state = range.rangeState || "NEVER DEPLOYED"

          return (
            <Card key={rangeKey} className="overflow-hidden">
              <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
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
                          <Wifi className={cn("h-3 w-3", dashboardDataSyncing ? "text-yellow-400 animate-pulse" : "text-green-400")} />
                          {new Date(rangeDataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </div>
                      )}
                    </div>
                  </div>
              </CardHeader>

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
                    <Button variant="outline" onClick={() => handlePowerAll("on")} disabled={!!pendingAction || !!powerAllPending} className="gap-1.5">
                      {powerAllPending === "on"
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-green-400" />
                        : <Power className="h-3.5 w-3.5 text-green-400" />}
                      {powerAllPending === "on" ? "Powering on…" : "All On"}
                    </Button>
                    <Button variant="outline" onClick={() => handlePowerAll("off")} disabled={!!pendingAction || !!powerAllPending} className="gap-1.5">
                      {powerAllPending === "off"
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-red-400" />
                        : <PowerOff className="h-3.5 w-3.5 text-red-400" />}
                      {powerAllPending === "off" ? "Powering off…" : "All Off"}
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
                      disabled={manualDashboardRefresh || rangeCtxLoading || rangesFetching}
                      className="ml-auto"
                    >
                      <RefreshCw className={cn("h-4 w-4", manualDashboardRefresh && "animate-spin")} />
                    </Button>
                    {range.testingEnabled && (
                      <Badge variant="warning" className="flex items-center gap-1 px-3 py-1.5">
                        <Shield className="h-3 w-3" /> Testing Mode
                      </Badge>
                    )}
                    {/* Destructive zone — separated to avoid accidental clicks */}
                    <div className="w-px h-6 bg-border/60 mx-1 self-center" />
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-amber-400/90 hover:text-amber-300 border-amber-500/40 hover:bg-amber-500/10"
                      disabled={
                        !!pendingAction ||
                        state === "DEPLOYING" ||
                        vms.length === 0 ||
                        !!deletingRangeId ||
                        destroyingAllVmsRangeId === (range.rangeID || rangeKey)
                      }
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDestroyAllVms(
                          range.rangeID || rangeKey,
                          range.name || range.rangeID || rangeKey,
                          vms.length,
                          vms.map((v) => v.ip).filter((ip) => typeof ip === "string" && ip.trim() !== ""),
                        )
                      }}
                    >
                      {destroyingAllVmsRangeId === (range.rangeID || rangeKey) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ServerOff className="h-3.5 w-3.5" />
                      )}
                      {destroyingAllVmsRangeId === (range.rangeID || rangeKey) ? "Destroying…" : "Destroy all VMs"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-red-400/70 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/30"
                      disabled={
                        !!pendingAction ||
                        state === "DEPLOYING" ||
                        !!deletingRangeId ||
                        destroyingAllVmsRangeId === (range.rangeID || rangeKey)
                      }
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
                              {goadElapsed && (
                                <> · <span className="font-mono text-amber-400/80">{goadElapsed}</span></>
                              )}
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

                  {/* Post-GOAD firewall redeploy banner — shown when the network-tag
                      deploy is in progress after a GOAD action completed. */}
                  {!activeGoadTask && latestGoadTask?.phase === "network-deploy" && goadInstanceForRange && (
                    <Alert className="border-blue-500/30 bg-blue-500/[0.06]">
                      <Shield className="h-4 w-4 text-blue-400" />
                      <AlertDescription className="flex items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-medium">
                            Firewall redeploy running (post-GOAD {goadTaskShortKind(latestGoadTask.command).toLowerCase()})
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-400 text-[11px]">
                              <Check className="h-2.5 w-2.5" />
                              Step 1 — GOAD done
                            </span>
                            <span className="text-muted-foreground/60 text-[11px]">→</span>
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 text-[11px] animate-pulse">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              Step 2 — Firewall redeploy running
                            </span>
                          </div>
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
                  )}

                  {/* ── Deploy logs ─────────────────────────────────────── */}
                  {showLogs && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          <Activity className={cn("h-3.5 w-3.5", isStreaming && "animate-pulse text-green-400")} />
                          Deploy Logs
                          {isStreaming && <Badge variant="success" className="text-xs">Live</Badge>}
                          {rangeElapsed && (
                            <span className="font-mono text-[11px] text-green-400/80 border border-green-500/20 bg-green-500/5 px-1.5 py-0.5 rounded">
                              {rangeElapsed}
                            </span>
                          )}
                        </h4>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setShowLogs(false)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <LogViewer
                        lines={logLines}
                        onClear={clearLogs}
                        maxHeight="300px"
                        live={isStreaming}
                        liveLabel="Deploy logs"
                        onRefresh={selectedRangeId?.trim() ? handleRefreshDeployLogs : undefined}
                        refreshLoading={deployLogRefreshBusy}
                        downloadFilename={`ludus-deploy-${(selectedRangeId ?? "range").replace(/[^a-zA-Z0-9_-]+/g, "_")}`}
                      />
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
                            enrichment={logMarkerEnrichment ?? undefined}
                            goadInstanceId={goadInstanceForRange}
                            goadTasks={
                              goadInstanceForRange
                                ? goadTasksListLoading
                                  ? undefined
                                  : (goadTasksForRange ?? [])
                                : undefined
                            }
                            onRefresh={() => {
                              void queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(scopeTag, selectedRangeId) })
                              void queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogEnrichment(scopeTag, selectedRangeId) })
                              void queryClient.invalidateQueries({ queryKey: [...queryKeys.goadTasks(), scopeTag], exact: false })
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
                              queryKey: queryKeys.vmOperationLog(scopeTag, selectedRangeId),
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
                Generating inventory on the server is often slow. Re-opening the same range within a moment uses a
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
              onClick={() => {
                const dlg = inventoryDialog
                const text = dlg?.text?.trim()
                if (!dlg || !text) return
                downloadText(
                  text,
                  `${dlg.rangeId.replace(/[^a-zA-Z0-9._-]/g, "_")}-inventory.txt`,
                )
              }}
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
