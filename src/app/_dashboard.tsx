"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ludusVersionLabel, ludusVersionText } from "@/lib/ludus/ludus-releases"
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
import dynamic from "next/dynamic"
// Deploy-log viewer (and its virtualization dep) only loads once the user opens
// logs, keeping it out of the initial dashboard bundle.
const LogViewer = dynamic(() => import("@/components/range/log-viewer").then((m) => m.LogViewer), {
  ssr: false,
  loading: () => <div className="p-4 text-xs italic text-muted-foreground">Loading logs…</div>,
})
import { PaginatedLogHistoryList } from "@/components/range/log-history-list"
import { timeAgo, cn, downloadTextFile, extractArray, getRangeStateBadge } from "@/lib/core/utils"
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
  RotateCw,
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
import { ludusApi, getImpersonationHeaders, getVmOperationLog, postVmOperationAudit, pruneKnownHosts, cleanupGoadWorkspaceAfterRangeDelete } from "@/lib/ui/api"
import { dropGoadInstanceFromCache } from "@/lib/goad/goad-instance-list-cache"
import {
  isRouterTemplateReadyForDeploy,
  requiredRouterTemplateName,
} from "@/lib/ludus/ludus-router-template"
import {
  goadTaskShortKind,
  correlateHistoryEntries,
  aggregateDeployStatuses,
  type GoadTaskForCorrelation,
} from "@/lib/goad/goad-deploy-history-correlation"
import { useRange } from "@/lib/range/range-context"
import type { RangeObject, VMObject, LogHistoryEntry } from "@/lib/core/types"
import type { RangeLogMarkerEnrichment } from "@/lib/logs/range-log-marker-types"
import { useToast } from "@/hooks/use-toast"
import { useDeployLogContext } from "@/lib/logs/deploy-log-context"
import { useElapsed } from "@/hooks/use-elapsed"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { queryKeys } from "@/lib/ui/query-keys"
import { isLudusAwaitResponseTimeoutMessage, tryToastLudusSlowHttpError } from "@/lib/ludus/ludus-timeout-ui"
import { useEffectiveScopeTag } from "@/lib/session/effective-scope-context"
import { STALE } from "@/lib/ui/query-client"
import { omitBlankLogLines } from "@/lib/logs/log-line-timestamp"
import { stampHistoryWithRecordedClock } from "@/lib/logs/deploy-log-clock"
import { splitLogText } from "@/lib/logs/strip-ansi"
import { fetchGoadTaskLogLines } from "@/lib/goad/goad-task-lines"
import { fetchDeployElapsedAnchorMs } from "@/lib/range/range-deploy-elapsed-anchor"
import {
  clearRangeAborting,
  isRangeAborting,
} from "@/lib/range/range-aborting"
import { useAbortRange } from "@/lib/ui/use-abort-range"
import { IMPERSONATION_CHANGED_EVENT } from "@/lib/session/impersonation-context"
import {
  pickNetworkFollowupDeployRow,
  isDeployHistoryRunning,
} from "@/lib/range/wait-lux-network-tag-deploy"
import {
  clearVmPartialListStreak,
  dedupeVMs,
  resolveVmListForRangeQuery,
  vmIsRunning,
} from "@/lib/ui/dashboard-vm-merge"
import { restartRangeVms, waitForVmPowerConfirmation } from "@/lib/proxmox/wait-for-vm-power-state"
import { LudusHostResources } from "@/components/dashboard/ludus-host-resources"
import {
  DeployStartupRangeStatusError,
  TransientRangeStatusError,
  RangeStatusError,
  describeRangeRefreshState,
  isTransientRangeStatus,
  rangeErrorHidesStaleData,
  rangeErrorKeepsSnapshot,
} from "@/lib/ui/range-refresh-state"
import { fetchPersistedRangeStatus } from "@/lib/ui/range-pb-status"
import { mergePersistedRangeState } from "@/lib/ui/range-state-merge"

/** Dashboard snapshot: Ludus live VMs plus PocketBase persisted fields. */
type DashboardRangeSnapshot = RangeObject & {
  /** VM identity keys retained from a previous poll and not confirmed by the latest one. */
  __unconfirmedVmKeys?: string[]
  /** Store that supplied persisted fields in this snapshot. */
  __persistedStateSource?: "pocketbase" | "ludus" | "unknown"
}

/** Re-open inventory for the same range without waiting on Ludus again. */
const INVENTORY_CACHE_MS = 3 * 60 * 1000

export function DashboardPageClient({
  initialHostResources = false,
}: {
  /** True when SSR prefetched a host snapshot, so hydration can render it safely. */
  initialHostResources?: boolean
}) {
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

  const hasNoRanges = !rangeCtxLoading && accessibleRanges.length === 0
  /** Sidebar still restoring sessionStorage/cookie selection — avoid "No ranges available yet". */
  const waitingForRangeSelection =
    rangeCtxLoading || (accessibleRanges.length > 0 && !selectedRangeId?.trim())

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
  const [powerAllPending, setPowerAllPending] = useState<"on" | "off" | "restart" | null>(null)
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
  // Persisted range fields come from PocketBase (Ludus's backend store); live VM
  // inventory comes from Ludus `/range`. A failed poll is NOT relabeled as fresh:
  // React Query keeps the last verified data and `dataUpdatedAt` stays at the
  // last success, so the UI can show "Refreshing" or "Unavailable" truthfully.
  const {
    data: rangeData,
    isLoading,
    isFetching,
    isPlaceholderData,
    error: rangeError,
    refetch: refetchRangeStatus,
    dataUpdatedAt: rangeDataUpdatedAt,
  } = useQuery<DashboardRangeSnapshot | null>({
    queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId),
    queryFn: async () => {
      const rid = selectedRangeId?.trim()
      if (!rid) return null

      const ludusResult = await ludusApi.getRangeStatus(rid)

      if (ludusResult.error) {
        const message =
          typeof ludusResult.error === "string" ? ludusResult.error : "Failed to load range status"
        if (ludusResult.status === 400) throw new DeployStartupRangeStatusError(message)
        if (isTransientRangeStatus(ludusResult.status)) {
          throw new TransientRangeStatusError(message)
        }
        throw new RangeStatusError(message, ludusResult.status)
      }

      const data = ludusResult.data
      if (!data) return null
      const rawVMs = data.VMs || (data as RangeObject & { vms?: VMObject[] }).vms || []
      const newVMs = dedupeVMs(rawVMs)

      // Ludus GET /range sometimes returns an empty or *short* VMs array on one poll (deploy,
      // Proxmox hiccup, or slow inventory). Prefer cache / numberOfVMs so refresh does not hide VMs.
      const prev = queryClient.getQueryData<DashboardRangeSnapshot>(
        queryKeys.rangeStatus(scopeTag, selectedRangeId),
      )
      const prevVMs = prev?.VMs || (prev as (RangeObject & { vms?: VMObject[] }) | undefined)?.vms || []
      const state = (data.rangeState || "").toString().toUpperCase()
      const resolved = resolveVmListForRangeQuery({
        data,
        newVMs,
        prevVMs,
        stateUpper: state,
        scopeTag,
        rangeId: rid,
      })

      return {
        ...data,
        VMs: resolved.vms,
        __unconfirmedVmKeys: resolved.unconfirmedVmKeys,
        __persistedStateSource: "ludus" as const,
      }
    },
    enabled: !rangeCtxLoading && !hasNoRanges && !!selectedRangeId?.trim(),
    staleTime: STALE.realtime,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // HTTP 400 during deploy/log-stream startup, network loss, and 5xx are
    // retryable. Auth/permission failures are surfaced immediately.
    retry: (failureCount, error) =>
      error instanceof TransientRangeStatusError && failureCount < 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      // When switching ranges, do not show the previous range's VM table as a placeholder.
      placeholderData: (previousData, previousQuery) => {
        if (!previousData || !previousQuery) return previousData
        const pk = previousQuery.queryKey
        const ck = queryKeys.rangeStatus(scopeTag, selectedRangeId)
        if (pk[pk.length - 1] !== ck[ck.length - 1]) return undefined
        return previousData
      },
  })

  const rangeRefresh = describeRangeRefreshState({
    isLoading,
    isFetching,
    isError: !!rangeError,
    dataUpdatedAt: rangeDataUpdatedAt,
    error: rangeError,
  })
  const rangeAuthFailure = rangeErrorHidesStaleData(rangeError)
  /**
   * Stale rows stay up during a retry. A deploy-startup HTTP 400 keeps them
   * after retries too. Network loss, 5xx, and auth failures hide them once
   * the poll is no longer running.
   */
  const showStaleRangeData =
    !rangeAuthFailure &&
    (rangeErrorKeepsSnapshot(rangeError) ||
      !(rangeError && rangeRefresh.refreshState === "unavailable"))
  const liveRangeData = showStaleRangeData ? rangeData : null

  // Persisted fields (state, testing, allow lists) come from PocketBase on
  // their own query. The VM table does not wait for that read.
  const { data: persistedStatus } = useQuery({
    queryKey: queryKeys.rangePersisted(scopeTag, selectedRangeId),
    queryFn: async () => {
      const rid = selectedRangeId?.trim()
      if (!rid) return null
      return fetchPersistedRangeStatus(rid)
    },
    enabled: !rangeCtxLoading && !hasNoRanges && !!selectedRangeId?.trim(),
    staleTime: STALE.short,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })

  const visibleRangeData = useMemo(() => {
    if (!liveRangeData) return null
    const persisted = persistedStatus?.range
    if (!persisted) return liveRangeData
    const snapshot = mergePersistedRangeState(liveRangeData, persisted, persistedStatus.source)
    if (!snapshot) return liveRangeData
    return {
      ...snapshot.range,
      VMs: liveRangeData.VMs,
      __unconfirmedVmKeys: liveRangeData.__unconfirmedVmKeys,
      __persistedStateSource: snapshot.persistedStateSource,
    }
  }, [liveRangeData, persistedStatus])
  const unconfirmedVmKeys = visibleRangeData?.__unconfirmedVmKeys ?? []

  // ── Version query ───────────────────────────────────────────────────────────
  // `select` collapses the payload to the version string so consumers only
  // re-render when the string itself changes.
  const { data: version = "", isPending: versionPending } = useQuery({
    queryKey: queryKeys.version(scopeTag),
    queryFn: async () => {
      const result = await ludusApi.getVersion()
      if (result.error || result.data == null) {
        throw new Error(typeof result.error === "string" && result.error ? result.error : "Ludus version unavailable")
      }
      return result.data
    },
    select: (data) => ludusVersionText(data),
    staleTime: STALE.realtime,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })

  const { data: ludusRelease } = useQuery({
    queryKey: ["ludus", "releases"],
    queryFn: async () => {
      const res = await fetch("/api/ludus/releases", { cache: "no-store" })
      if (!res.ok) return null
      return (await res.json()) as { latestStable?: string | null; updateAvailable?: boolean }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })

  const { data: deployHistoryEntries = [], isLoading: deployHistoryListLoading, isFetching: deployHistoryRefreshing } =
    useQuery({
      queryKey: queryKeys.rangeLogHistory(scopeTag, selectedRangeId),
      queryFn: async () => {
        const result = await ludusApi.getRangeLogHistory(selectedRangeId ?? undefined)
        return extractArray<LogHistoryEntry>(result.data as unknown)
      },
    enabled: !rangeCtxLoading && !hasNoRanges && !!selectedRangeId,
    staleTime: STALE.short,
    refetchInterval: 15_000,
  })

  /** True when Ludus or deploy history suggests work in flight — keep polling GOAD tasks even if the last /tasks fetch had no "running" row yet (race / gap between installs). */
  const shouldPollGoadTasksAux = useMemo(() => {
    const hist = deployHistoryEntries.some((e) => {
      const s = (e.status || "").toLowerCase()
      return s === "running" || s === "waiting"
    })
    const rs = (visibleRangeData?.rangeState ?? "").toString().toUpperCase()
    const rangeBusy = rs === "DEPLOYING" || rs === "WAITING"
    return hist || rangeBusy
  }, [deployHistoryEntries, visibleRangeData?.rangeState])

  const { data: goadInstanceForRange = null } = useQuery({
    queryKey: queryKeys.goadInstanceForRange(scopeTag, selectedRangeId ?? ""),
    queryFn: async () => {
      if (!selectedRangeId) return null
      const res = await fetch(`/api/goad/by-range?rangeId=${encodeURIComponent(selectedRangeId)}`, {
        credentials: "include",
        headers: { ...getImpersonationHeaders() },
      })
      if (!res.ok) throw new Error(`GOAD lookup failed (${res.status})`)
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
    // Pause the enrichment poll while the deploy-log SSE is actively streaming
    // this range — the live stream already carries the deploy progress, so the
    // 5s marker poll is redundant load until the stream ends.
    refetchInterval:
      shouldPollGoadTasksAux && !(isStreaming && streamingRangeId === (selectedRangeId ?? null))
        ? 5000
        : false,
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
          const raw = omitBlankLogLines(splitLogText(result.data.result))
          lines.push(
            ...(await stampHistoryWithRecordedClock(
              selectedRangeId ?? "",
              raw,
              result.data.start,
              result.data.end,
            )),
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
  const rangeDataId = !isPlaceholderData ? (visibleRangeData?.rangeID ?? visibleRangeData?.name ?? null) : null
  // Must depend on range state, not only range id: first fetch after redirect can still
  // show READY; when Ludus flips to DEPLOYING the id is unchanged — without this dep the
  // effect never re-runs and logs/stream never start until a full remount/refresh.
  const rangeStateForStream = !isPlaceholderData ? (visibleRangeData?.rangeState ?? null) : null
  const historyDeployInFlight = deployHistoryEntries.some((e) => isDeployHistoryRunning(e.status || ""))
  const deployLive =
    rangeStateForStream === "DEPLOYING" ||
    rangeStateForStream === "WAITING" ||
    historyDeployInFlight
  useEffect(() => {
    if (!visibleRangeData || isPlaceholderData || rangeCtxLoading || hasNoRanges) return
    const deployingLike = deployLive
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
  }, [selectedRangeId, rangeCtxLoading, rangeDataId, rangeStateForStream, deployLive, isStreaming])

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
  }, [aborting, selectedRangeId, queryClient, scopeTag])

  // ── Stream completion → refresh data and hide logs ─────────────────────────
  useEffect(() => {
    if (isStreaming || deployLive) return
    // streamRangeState is set when the SSE server sends [DONE] with the final
    // state. If the stream ended via [ERROR] line or a network onerror it stays
    // null — fall back to what Ludus's GET already told us.
    const finalState = streamRangeState ?? visibleRangeData?.rangeState ?? null
    if (finalState && finalState !== "DEPLOYING" && finalState !== "WAITING") {
      setDeploying(false)
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(scopeTag, selectedRangeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogEnrichment(scopeTag, selectedRangeId) })
      setTimeout(() => setShowLogs(false), 5000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, streamRangeState, deployLive])

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
    const tplRes = await ludusApi.listTemplates()
    if (!tplRes.error) {
      const rows = Array.isArray(tplRes.data)
        ? tplRes.data
        : tplRes.data &&
            typeof tplRes.data === "object" &&
            Array.isArray((tplRes.data as { templates?: unknown }).templates)
          ? (tplRes.data as { templates: Array<{ name?: string; built?: boolean }> }).templates
          : []
      const builtNames = new Set(
        rows.filter((t) => t && typeof t === "object" && t.built === true).map((t) => t.name ?? ""),
      )
      const allNames = new Set(
        rows.filter((t) => t && typeof t === "object").map((t) => t.name ?? ""),
      )
      const routerReady = isRouterTemplateReadyForDeploy({
        builtNames,
        allNames,
        ludusVersion: version,
      })
      if (!routerReady) {
        const required = requiredRouterTemplateName({
          ludusVersion: version,
          registeredTemplates: allNames,
        })
        toast({
          variant: "destructive",
          title: "Router template required",
          description: `${required} must be Packer-built before any Ludus range deploy. Open Templates to add/build it.`,
        })
        return
      }
    }

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

      const cleaned = await cleanupGoadWorkspaceAfterRangeDelete(rangeId)
      await dropGoadInstanceFromCache(queryClient, {
        instanceId: cleaned.instanceId ?? undefined,
        rangeId,
      })

      if (cleaned.instanceId && !cleaned.workspaceRemoved) {
        toast({
          variant: "destructive",
          title: "Range deleted, GOAD workspace remains",
          description: cleaned.errors.join("; ") || `${cleaned.instanceId} is still on the GOAD page until the workspace is removed.`,
        })
      } else {
        toast({ title: "Range deleted", description: `${rangeId} has been permanently removed` })
      }

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
    const vms = visibleRangeData?.VMs || (visibleRangeData as (RangeObject & { vms?: VMObject[] }) | null)?.vms || []
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

  const doRestartAll = async () => {
    const vms = rangeData?.VMs || (rangeData as (RangeObject & { vms?: VMObject[] }) | null)?.vms || []
    const vmNames = vms.filter(vmIsRunning).map((v: VMObject) => v.name || v.vmName || `vm-${v.ID}`).filter(Boolean)
    if (vmNames.length === 0) {
      toast({ variant: "destructive", title: "No running VMs", description: "Power on a VM before restarting it." })
      return
    }
    setPowerAllPending("restart")
    try {
      toast({
        title: "Restarting running VMs",
        description: `${vmNames.length} VM${vmNames.length === 1 ? "" : "s"} will power off, then power back on.`,
      })
      const noteSlow = (error: string) => {
        if (!isLudusAwaitResponseTimeoutMessage(error)) return
        tryToastLudusSlowHttpError({
          toast,
          error,
          slowTitle: "Slow response from Ludus",
          onSlow: () => { void invalidateRangeStatus() },
        })
      }
      const restarted = await restartRangeVms({
        rangeId: selectedRangeId ?? undefined,
        vmNames,
        continueAfterError: isLudusAwaitResponseTimeoutMessage,
        powerOff: async () => {
          const result = await ludusApi.powerOff(vmNames, selectedRangeId ?? undefined)
          if (result.error) noteSlow(result.error)
          return result
        },
        powerOn: async () => {
          const result = await ludusApi.powerOn(vmNames, selectedRangeId ?? undefined)
          if (result.error) noteSlow(result.error)
          return result
        },
        fetchStatus: () => ludusApi.getRangeStatus(selectedRangeId ?? undefined),
      })
      void invalidateRangeStatus()
      if (restarted.ok) {
        toast({ title: "Restart confirmed", description: `${vmNames.length} VM${vmNames.length === 1 ? "" : "s"} running` })
      } else if ("error" in restarted) {
        toast({ variant: "destructive", title: "Restart failed", description: restarted.error })
      } else if (restarted.via === "timeout") {
        toast({
          variant: "destructive",
          title: "Restart not confirmed yet",
          description: `${restarted.pending.length} VM(s) may still be ${restarted.phase === "off" ? "stopping" : "starting"}. Refresh to check.`,
        })
      }
    } finally {
      setPowerAllPending(null)
    }
  }
  const handleRestartAll = () =>
    confirm(
      "Restart all running VMs in this range? They power off, then power back on.",
      () => doRestartAll(),
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
      downloadTextFile("ludus-wireguard.conf", content)
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
  const primaryRange = visibleRangeData ?? null
  const allVMs = primaryRange?.VMs || (primaryRange as (RangeObject & { vms?: VMObject[] }) | null)?.vms || []
  /**
   * Never render a failed or unloaded poll as "No VMs deployed yet". Stale rows
   * stay visible only while a retry is actively running.
   */
  const vmTableState: "loading" | "error" | "empty" | "ready" =
    rangeAuthFailure || (rangeError && rangeRefresh.refreshState === "unavailable")
      ? "error"
      : !visibleRangeData && isLoading
        ? "loading"
        : allVMs.length === 0
          ? "empty"
          : "ready"
  const vmTableError = rangeAuthFailure
    ? rangeError instanceof Error
      ? rangeError.message
      : "Access denied"
    : rangeError
      ? rangeRefresh.lastError ?? "Range status unavailable"
      : null

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
  const rawRangeState = primaryRange?.rangeState?.trim() || ""
  const rangeState =
    historyDeployInFlight &&
    !["DEPLOYING", "WAITING"].includes(rawRangeState.toUpperCase())
      ? "DEPLOYING"
      : rawRangeState
  const error = rangeError ? (rangeError as Error).message : null
  /**
   * Without a verified snapshot there is no range state or VM count to report.
   * Showing "NEVER DEPLOYED" / 0 would invent infrastructure state.
   */
  const statsUnavailable =
    !visibleRangeData &&
    (rangeAuthFailure || (rangeError && rangeRefresh.refreshState === "unavailable"))

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
      <div className="sr-only" role="status" aria-live="polite">
        {selectedRangeId
          ? primaryRange
            ? `Range ${selectedRangeId}: ${rangeState || "unknown"}`
            : `Range ${selectedRangeId}: loading`
          : ""}
        {rangeRefresh.refreshState === "retrying"
          ? ", refreshing"
          : rangeRefresh.refreshState === "unavailable"
            ? ", unavailable"
            : ""}
      </div>
      {error && (
        <div className="sr-only" role="alert">
          {error}
        </div>
      )}
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
            : statsUnavailable
              ? <Badge variant="outline" className="text-xs text-muted-foreground">Unavailable</Badge>
              : rangeState
                ? <Badge className={cn("text-xs", getRangeStateBadge(rangeState))}>{rangeState}</Badge>
                : "—"}
        />
        <StatCard title="Total VMs" icon={<Server className="h-4 w-4 text-status-info" />}
          value={isLoading ? "—" : statsUnavailable ? "—" : String(allVMs.length)} />
        <StatCard title="Running" icon={<CheckCircle2 className="h-4 w-4 text-status-success" />}
          value={isLoading ? "—" : statsUnavailable ? "—" : String(runningVMs)}
          subtext={!statsUnavailable && allVMs.length > 0 ? `${Math.round((runningVMs / allVMs.length) * 100)}% online` : undefined}
        />
        <StatCard title="Ludus Version" icon={<Layers className="h-4 w-4 text-primary" />}
          value={version ? ludusVersionLabel(version) || "—" : "—"}
          subtext={
            ludusRelease?.updateAvailable && ludusRelease.latestStable
              ? `Update ${ludusRelease.latestStable} available`
              : version
                ? version.slice(0, version.indexOf(ludusVersionLabel(version))).trim() || undefined
                : versionPending
                  ? undefined
                  : "Not connected"
          }
        />
      </div>

      <div className="grid items-stretch gap-3 lg:grid-cols-2">
      <LudusHostResources initialHostResources={initialHostResources} />

      {/* ── WireGuard — account-wide VPN (same profile for all accessible ranges) ── */}
      <Card className="border-status-info/25 bg-blue-500/[0.06]">
        <CardContent className="flex h-full items-center justify-between gap-3 p-3">
          <div className="min-w-0 space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Wifi className="h-4 w-4 shrink-0 text-status-info" />
              WireGuard VPN
            </h3>
            <p className="truncate text-xs text-muted-foreground">
              One tunnel for this account
              {accessibleRanges.length > 0
                ? `: ${accessibleRanges.map((r) => r.rangeID).join(", ")}`
                : "."}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            className="shrink-0 gap-2 bg-blue-600 text-white hover:bg-blue-600/90"
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
      </div>

      {/* ── Selected range (single card; range switcher is in the sidebar) ─── */}
      {waitingForRangeSelection ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isLoading && !visibleRangeData ? (
        // Keep the range card in place while the first status poll runs so the
        // VM table can show skeleton rows instead of a blank page.
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Server className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">
                {accessibleRanges.find((r) => r.rangeID === selectedRangeId)?.rangeID ||
                  selectedRangeId ||
                  "Range"}
              </CardTitle>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <VMTable
              vms={[]}
              rangeId={selectedRangeId ?? undefined}
              state="loading"
              onRefresh={() => void handleRefreshDashboard()}
            />
          </CardContent>
        </Card>
      ) : rangeError && !visibleRangeData ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 mx-auto text-status-warning" />
            <p className="font-medium">
              {rangeAuthFailure ? "Range access denied" : "Range status unavailable"}
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              {rangeError instanceof Error ? rangeError.message : "The range status request failed."}
            </p>
            <Button
              className="gap-1.5"
              variant="outline"
              onClick={() => void refetchRangeStatus()}
              disabled={isFetching}
            >
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {isFetching ? "Retrying…" : "Retry"}
            </Button>
          </CardContent>
        </Card>
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
          const rawState = range.rangeState?.trim() || ""
          const state =
            historyDeployInFlight &&
            !["DEPLOYING", "WAITING"].includes(rawState.toUpperCase())
              ? "DEPLOYING"
              : rawState

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
                        <span className="text-status-success font-medium">{running}</span>
                        <span> / {vms.length} running</span>
                      </span>
                      {state ? (
                      <Badge
                        className={cn("text-xs", getRangeStateBadge(state))}
                        title={
                          range.__persistedStateSource === "pocketbase"
                            ? "Persisted state from PocketBase"
                            : range.__persistedStateSource === "ludus"
                              ? "Persisted state from Ludus (PocketBase unavailable)"
                              : "Persisted state source unknown"
                        }
                      >
                        {state}
                      </Badge>
                      ) : null}
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
                      {rangeAuthFailure ? (
                        <div className="flex items-center gap-1 text-xs text-status-error">
                          <AlertTriangle className="h-3 w-3" />
                          <span>{rangeError instanceof Error ? rangeError.message : "Access denied"}</span>
                        </div>
                      ) : rangeError ? (
                        <div className="flex items-center gap-1 text-xs">
                          {rangeRefresh.refreshState === "retrying" ? (
                            <Loader2 className="h-3 w-3 animate-spin text-status-warning" />
                          ) : (
                            <AlertTriangle className="h-3 w-3 text-status-error" />
                          )}
                          <span
                            className={
                              rangeRefresh.refreshState === "retrying"
                                ? "text-status-warning"
                                : "text-status-error"
                            }
                          >
                            {rangeRefresh.refreshState === "retrying" ? "Refreshing" : "Unavailable"}
                            {rangeRefresh.lastVerifiedAt
                              ? ` — last verified ${new Date(rangeRefresh.lastVerifiedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                              : ""}
                          </span>
                          {rangeRefresh.refreshState === "unavailable" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-[11px]"
                              onClick={() => void refetchRangeStatus()}
                              disabled={isFetching}
                            >
                              Retry
                            </Button>
                          )}
                        </div>
                      ) : rangeDataUpdatedAt > 0 ? (
                        <div
                          className="flex items-center gap-1 text-xs text-muted-foreground"
                          title="Verified range status"
                        >
                          <Wifi className={cn("h-3 w-3", dashboardDataSyncing ? "text-status-warning animate-pulse" : "text-status-success")} />
                          {new Date(rangeDataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </div>
                      ) : null}
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
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-status-success" />
                        : <Power className="h-3.5 w-3.5 text-status-success" />}
                      {powerAllPending === "on" ? "Powering on…" : "All On"}
                    </Button>
                    <Button variant="outline" onClick={() => handleRestartAll()} disabled={!!pendingAction || !!powerAllPending} className="gap-1.5">
                      {powerAllPending === "restart"
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-status-info" />
                        : <RotateCw className="h-3.5 w-3.5 text-status-info" />}
                      {powerAllPending === "restart" ? "Restarting…" : "Restart"}
                    </Button>
                    <Button variant="outline" onClick={() => handlePowerAll("off")} disabled={!!pendingAction || !!powerAllPending} className="gap-1.5">
                      {powerAllPending === "off"
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-status-error" />
                        : <PowerOff className="h-3.5 w-3.5 text-status-error" />}
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
                          className="gap-1.5 border-status-warning/40 text-amber-300 hover:bg-status-warning/10 hover:text-amber-200"
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
                      className="gap-1.5 text-status-warning/90 hover:text-amber-300 border-status-warning/40 hover:bg-status-warning/10"
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
                      className="gap-1.5 text-status-error/70 hover:text-status-error hover:bg-status-error/10 border border-transparent hover:border-status-error/30"
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
                      <Alert className="border-status-warning/30 bg-amber-500/[0.06]">
                        <Puzzle className="h-4 w-4 text-status-warning" />
                        <AlertDescription className="flex items-center justify-between gap-3">
                          <div className="min-w-0 space-y-0.5">
                            <p className="text-xs font-medium">{headline}</p>
                            <p className="text-[11px] text-muted-foreground">
                              Started {timeAgo(activeGoadTask.startedAt)}
                              {goadElapsed && (
                                <> · <span className="font-mono text-status-warning/80">{goadElapsed}</span></>
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
                      <Shield className="h-4 w-4 text-status-info" />
                      <AlertDescription className="flex items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-medium">
                            Firewall redeploy running (post-GOAD {goadTaskShortKind(latestGoadTask.command).toLowerCase()})
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded border border-status-success/30 bg-status-success/10 text-status-success text-[11px]">
                              <Check className="h-2.5 w-2.5" />
                              Step 1 — GOAD done
                            </span>
                            <span className="text-muted-foreground/60 text-[11px]">→</span>
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded border border-status-info/40 bg-status-info/10 text-status-info text-[11px] animate-pulse">
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
                  {(showLogs || deployLive) && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          <Activity className={cn("h-3.5 w-3.5", isStreaming && "animate-pulse text-status-success")} />
                          Deploy Logs
                          {isStreaming && <Badge variant="success" className="text-xs">Live</Badge>}
                          {rangeElapsed && (
                            <span className="font-mono text-[11px] text-status-success/80 border border-status-success/20 bg-status-success/5 px-1.5 py-0.5 rounded">
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
                      <Activity className="h-3.5 w-3.5 animate-pulse text-status-success" />
                      Show deploy logs
                    </Button>
                  )}

                  {/* ── VM table with console actions ────────────────────── */}
                  <VMTable
                    vms={vms}
                    rangeId={selectedRangeId ?? undefined}
                    state={vmTableState}
                    errorMessage={vmTableError}
                    onRetry={() => void refetchRangeStatus()}
                    unconfirmedVmKeys={unconfirmedVmKeys}
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
            <pre className="mt-2 mb-4 flex-1 resize-y min-h-[200px] max-h-[60vh] overflow-auto rounded-md border border-border bg-black/60 p-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
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
