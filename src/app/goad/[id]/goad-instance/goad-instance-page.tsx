"use client"

/** Milliseconds without a new log line before the deploy stream is considered stalled
 *  and will be reconnected.  15 s is aggressive enough to feel responsive without
 *  causing spurious reconnects on Ludus' ~10 s log-flush intervals. */
const DEPLOY_STREAM_STALL_MS = 15_000

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useDeployLogContext } from "@/lib/deploy-log-context"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs } from "@/components/ui/tabs"
import { useGoadStream } from "@/components/goad/goad-terminal"
import { ArrowLeft, Loader2 } from "lucide-react"
import type {
  GoadInstance,
  GoadCatalog,
  GoadExtensionDef,
  GoadLabDef,
  TemplateObject,
  LogHistoryEntry,
} from "@/lib/types"
import { ludusApi } from "@/lib/api"
import { registerLuxDeployTagRun } from "@/lib/register-lux-deploy-tag-run"
import type { RangeLogMarkerEnrichment } from "@/lib/range-log-marker-types"
import { goadChainDebug } from "@/lib/goad-chain-debug"
import {
  extensionIsProvisionOnly,
  goadSupportsProvisionOnlyExtensions,
} from "@/lib/goad-catalog-capabilities"
import type { InstanceInventoryFile } from "@/lib/goad-ssh"
import { cn, extractArray, timeAgo } from "@/lib/utils"
import { augmentLudusDeployHistoryLines } from "@/lib/log-line-timestamp"
import { useElapsed } from "@/hooks/use-elapsed"
import { useToast } from "@/hooks/use-toast"
import { useConfirm } from "@/hooks/use-confirm"
import { useGoadRunAction } from "@/hooks/use-goad-run-action"
import { useGoadInstanceActionHandlers } from "@/hooks/use-goad-instance-action-handlers"
import { useImpersonation } from "@/lib/impersonation-context"
import { useRange } from "@/lib/range-context"
import {
  type CorrelatedHistoryEntry,
  type GoadTaskForCorrelation,
  correlateHistoryEntries,
} from "@/lib/goad-deploy-history-correlation"
import { GoadDeployTab } from "@/components/goad/goad-instance-tabs/goad-deploy-tab"
import { GoadTerminalTab } from "@/components/goad/goad-instance-tabs/goad-terminal-tab"
import { GoadInfoTab } from "@/components/goad/goad-instance-tabs/goad-info-tab"
import { GoadInventoriesTab } from "@/components/goad/goad-instance-tabs/goad-inventories-tab"
import { GoadExtensionsTab } from "@/components/goad/goad-instance-tabs/goad-extensions-tab"
import { GoadHistoryTab } from "@/components/goad/goad-instance-tabs/goad-history-tab"
import { GoadInstanceHeader } from "@/components/goad/goad-instance-tabs/goad-instance-header"
import { GoadInstanceActionBar } from "@/components/goad/goad-instance-tabs/goad-instance-action-bar"
import { GoadReassignDialog } from "@/components/goad/goad-instance-tabs/goad-reassign-dialog"
import { GoadInstanceTabTriggers } from "@/components/goad/goad-instance-tabs/goad-instance-tab-triggers"
import { fetchGoadTaskLogLines } from "@/lib/goad-task-lines"
import {
  applyNetworkSection,
  networkSectionEqual,
  type NetworkSnapshot,
} from "@/lib/network-rules"
import { LUDUS_WAIT_ABSOLUTE_MAX_MS, waitUntilLudusRangeNotDeploying } from "@/lib/wait-ludus-range-state"
import { waitForNetworkTagDeployCompletion } from "@/lib/wait-lux-network-tag-deploy"
import { fetchDeployElapsedAnchorMs } from "@/lib/range-deploy-elapsed-anchor"
import { useAbortRange } from "@/lib/use-abort-range"
import {
  parseAnsibleInstalledSets,
  type AnsibleInstalledSets,
} from "@/lib/goad-dependency-service"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { useShellSession } from "@/components/providers/shell-session-provider"
import {
  normalizeGoadInstanceTab,
  readInitialGoadTab,
  isDeployActionCommand,
  DEPLOY_TAB_ACTIONS,
} from "@/components/goad/goad-instance-tab-utils"
import type { GoadPostProcessingStep } from "@/components/goad/goad-instance-tabs/types"

// ── Template readiness helpers ────────────────────────────────────────────────

function GoadInstancePage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const shell = useShellSession()
  const queryClient = useQueryClient()
  const instanceId = decodeURIComponent(params.id as string)

  const [instance, setInstance] = useState<GoadInstance | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const initialInstanceLoadDone = useRef(false)
  /** Prevents double-handling `?deployLogId=` from the URL. */
  const historyUrlHandledRef = useRef<string | null>(null)
  const [initializingRange, setInitializingRange] = useState(false)
  // Unified confirmation (supports scoped per-row prompts via the `key` arg).
  // Extension install / remove / reprovision use scoped keys so the prompt
  // renders inline next to the triggering row instead of jumping to the top.
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()
  const scopeTag = useEffectiveScopeTag()
  const { abortRange: abortRangeUnified, isAborting } = useAbortRange(scopeTag)
  const { impersonation, impersonationHeaders } = useImpersonation()
  const goadListQueryBucket = impersonation?.username ?? "self"
  const { lines, isRunning, exitCode, taskId, run, resumeTask, stop, clear } = useGoadStream({
    getExtraHeaders: impersonationHeaders,
  })
  const [currentAction, setCurrentAction] = useState<string | null>(null)
  const { refreshRanges } = useRange()
  const {
    lines: rangeLogLines,
    isStreaming: isRangeStreaming,
    rangeState,
    streamStartedAt: rangeStreamStartedAt,
    startStreaming: startRangeStreaming,
    stopStreaming: stopRangeStreaming,
    clearLogs: clearRangeLogs,
    refreshRangeStateFromServer,
  } = useDeployLogContext()

  const isRangeStreamingRef = useRef(isRangeStreaming)
  isRangeStreamingRef.current = isRangeStreaming

  const rangeLogRefreshLock = useRef(false)
  const [rangeLogRefreshBusy, setRangeLogRefreshBusy] = useState(false)
  const handleRefreshRangeLogs = useCallback(() => {
    const rid = instance?.ludusRangeId?.trim()
    if (!rid || rangeLogRefreshLock.current) return
    rangeLogRefreshLock.current = true
    setRangeLogRefreshBusy(true)
    stopRangeStreaming()
    void (async () => {
      const historyAnchor = await fetchDeployElapsedAnchorMs((id) => ludusApi.getRangeLogHistory(id), rid)
      startRangeStreaming(rid, {
        snapshotStart: false,
        ...(historyAnchor != null ? { deployElapsedAnchorMs: historyAnchor } : {}),
      })
      void refreshRangeStateFromServer(rid)
      window.setTimeout(() => {
        rangeLogRefreshLock.current = false
        setRangeLogRefreshBusy(false)
      }, 750)
    })()
  }, [
    instance?.ludusRangeId,
    stopRangeStreaming,
    startRangeStreaming,
    refreshRangeStateFromServer,
  ])

  // Track when the GOAD process started so we can show a live elapsed timer.
  const [goadStreamStartedAt, setGoadStreamStartedAt] = useState<number | null>(null)
  // Clear timer when the task stops; start time is set from server data in the
  // taskId useEffect so it survives page refresh (uses task.startedAt, not Date.now).
  useEffect(() => {
    if (!isRunning) setGoadStreamStartedAt(null)
  }, [isRunning])

  // Range log timer: Ludus deploy elapsed — `streamStartedAt` is anchored to the
  // in-flight deploy history row when reconnecting (refresh) so it does not reset.
  const rangeElapsed = useElapsed(isRangeStreaming ? rangeStreamStartedAt : null)
  const goadElapsed = useElapsed(goadStreamStartedAt)

  const [catalog, setCatalog] = useState<GoadCatalog | null>(null)
  const [taskHistory, setTaskHistory] = useState<GoadTaskForCorrelation[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [deployHistory, setDeployHistory] = useState<LogHistoryEntry[]>([])
  const [deployHistoryLoading, setDeployHistoryLoading] = useState(false)
  const [logMarkerEnrichment, setLogMarkerEnrichment] = useState<RangeLogMarkerEnrichment | null>(null)
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<CorrelatedHistoryEntry | null>(null)
  const [historyDeployLines, setHistoryDeployLines] = useState<string[]>([])
  const [historyGoadLines, setHistoryGoadLines] = useState<string[]>([])
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false)
  const [activeTab, setActiveTab] = useState(() => readInitialGoadTab())
  // When state is DEPLOYING/WAITING and no live stream, reconnect once on the
  // rising edge (avoid reconnecting every 5s — that reset the SSE and could
  // disrupt range state / log continuity during long GOAD+Ludus runs).
  const prevPbDeployingRef = useRef(false)
  const lastDeployStreamReconnectRef = useRef(0)
  useEffect(() => {
    if (activeTab !== "deploy") return
    const rid = instance?.ludusRangeId?.trim()
    if (!rid) return

    const tick = async () => {
      const rs = await refreshRangeStateFromServer(rid)
      const deploying = rs === "DEPLOYING" || rs === "WAITING"
      const now = Date.now()
      if (deploying && !isRangeStreamingRef.current) {
        const edge = !prevPbDeployingRef.current
        const stalled =
          prevPbDeployingRef.current &&
          now - lastDeployStreamReconnectRef.current > DEPLOY_STREAM_STALL_MS
        if (edge || stalled) {
          handleRefreshRangeLogs()
          lastDeployStreamReconnectRef.current = now
        }
      }
      if (!deploying) {
        prevPbDeployingRef.current = false
        lastDeployStreamReconnectRef.current = 0
      } else {
        prevPbDeployingRef.current = true
      }
    }
    void tick()
    const id = window.setInterval(() => {
      void tick()
    }, 5000)
    return () => window.clearInterval(id)
  }, [activeTab, instance?.ludusRangeId, refreshRangeStateFromServer, handleRefreshRangeLogs])
  const [templates, setTemplates] = useState<TemplateObject[]>([])
  const [ansibleInstalled, setAnsibleInstalled] = useState<AnsibleInstalledSets | null>(null)
  const [ansibleInstalledLoading, setAnsibleInstalledLoading] = useState(false)
  const builtNames = new Set(templates.filter((t) => t.built).map((t) => t.name))
  const allNames   = new Set(templates.map((t) => t.name))

  // ── Deploy failure watchdogs ──────────────────────────────────────────────
  // Track whether we've seen DEPLOYING this session so we don't fire on
  // a pre-existing ERROR state at page load.
  const sawDeployingRef   = useRef(false)
  // Guard against triggering both watchdogs for the same failure event.
  const autoStoppedRef    = useRef(false)
  /**
   * True while runAction is executing the post-GOAD network-tag deploy.
   * Watchdog B checks this to avoid aborting a legitimate LUX-initiated deploy.
   */
  const postProcessingRef = useRef(false)
  /** Always contains the latest task ID from useGoadStream for use in async closures. */
  const taskIdRef = useRef<string | null>(null)
  taskIdRef.current = taskId
  /**
   * Set to true before run() when the action has network rules — cleared in the
   * taskId useEffect once the hasNetworkRules PATCH has been sent. Allows the
   * dashboard to show "firewall redeploy queued" as soon as the task appears.
   */
  /**
   * "idle" — no post-processing in progress
   * "network-pending" — GOAD is running, network-tag deploy will follow
   * "network-deploying" — network-tag deploy is in progress
   */
  const [postProcessingStep, setPostProcessingStep] = useState<GoadPostProcessingStep>("idle")
  /** Prevents re-processing wizard network rules for the same task. */
  const wizardNetworkHandledRef = useRef(false)
  /**
   * Set by the server-side resume fallback when it finds a deploy-class task
   * running. Replaces the old sessionStorage actionStorageKey lookup: we now
   * derive the tab-switch hint from the server-stored task command instead of
   * a browser-local key that is invisible to other browsers / impersonators.
   */
  const resumedAsDeployRef = useRef(false)

  // Reset guards whenever a new deployment run begins.
  useEffect(() => {
    if (isRunning) {
      sawDeployingRef.current  = false
      autoStoppedRef.current   = false
      wizardNetworkHandledRef.current = false
    }
  }, [isRunning])

  // Watchdog A: range entered a terminal error state while GOAD is still running.
  // Stop the GOAD SSH process so it doesn't waste time running Ansible on failed
  // infrastructure (which would otherwise keep the command alive for a GOAD deployment).
  useEffect(() => {
    if (rangeState === "DEPLOYING" || rangeState === "WAITING") {
      sawDeployingRef.current = true
      return
    }
    const isTerminalError = rangeState === "ERROR" || rangeState === "ABORTED"
    if (!isTerminalError || !isRunning || !sawDeployingRef.current || autoStoppedRef.current) return
    autoStoppedRef.current = true
    stop()
    toast({
      variant: "destructive",
      title: "Range deployment failed",
      description: "The Ludus range encountered an error. The GOAD command has been stopped automatically.",
    })
  // Intentionally omits `stop` and `toast` — both are stable refs; adding them
  // would cause unnecessary re-registrations without changing behavior.
  }, [rangeState, isRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  const prevRangeStateForChainDebug = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevRangeStateForChainDebug.current
    prevRangeStateForChainDebug.current = rangeState
    const rid = instance?.ludusRangeId?.trim()
    if (
      rid &&
      (prev === "DEPLOYING" || prev === "WAITING") &&
      rangeState === "SUCCESS"
    ) {
      goadChainDebug("ludus_range_success", { rangeId: rid, instanceId })
    }
  }, [rangeState, instance?.ludusRangeId, instanceId])

  // Watchdog B: GOAD exited with failure (non-zero) but the range is still stuck
  // in DEPLOYING. Route through the unified abort hook so it goes through Ludus (user →
  // admin) and falls back to PocketBase if the goroutine has already exited.
  // Skip if postProcessingRef is set: runAction intentionally launched a
  // network-tag deploy AFTER GOAD finished — that's the DEPLOYING we see.
  useEffect(() => {
    if (exitCode === null || !instance?.ludusRangeId) return
    // Success: Ludus often stays DEPLOYING/WAITING briefly after GOAD exits 0
    // (merge deploy still settling). Must not treat that as a stuck failure.
    if (exitCode === 0) return
    if (rangeState !== "DEPLOYING" && rangeState !== "WAITING") return
    if (autoStoppedRef.current) return
    if (postProcessingRef.current) return
    autoStoppedRef.current = true
    const rangeId = instance.ludusRangeId
    void abortRangeUnified({
      rangeId,
      goadInstanceId: instance.instanceId,
      goadTaskId: taskId ?? null,
    })
    stopRangeStreaming()
    toast({
      variant: "destructive",
      title: "Deployment failed",
      description:
        "GOAD finished with a non-zero exit code while the range was still deploying. Resetting the range state automatically.",
    })
  // Intentionally omits `taskId`, `abortRangeUnified`, `stopRangeStreaming`, and `toast`
  // — stable refs/callbacks that must not re-trigger the effect on every render.
  }, [exitCode, rangeState, instance?.ludusRangeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Read ?tab=<value> from the URL on first mount (e.g. redirected from goad/new)
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab")
    if (tab) setActiveTab(normalizeGoadInstanceTab(tab))
  // Run only once on mount — URL params don't change and we don't want to
  // clobber a tab the user manually selected after initial load.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start range log streaming and (conditionally) switch to Deploy Status
  // tab whenever a task is running.  Covers two scenarios:
  //   1. runAction() — startRangeStreaming is already called there, but instance
  //      data may not be loaded yet on first render so we re-check here.
  //   2. Server-side resume — the mount effect queries /api/goad/tasks and calls
  //      resumeTask(), which sets isRunning=true; this effect kicks in.
  //
  // Tab-switching rules:
  //   • Only switch to "deploy" if the running action is one that involves Ludus
  //     range provisioning (DEPLOY_TAB_ACTIONS). Other actions (start, stop, …)
  //     should leave the user on the Terminal tab so they can see GOAD output.
  //   • New GOAD instance deployments (from goad/new) land here via ?tab=deploy
  //     in the URL and are already handled by the URL-param effect above.
  const autoTabRef = useRef(false)
  const wasGoadRunningRef = useRef(false)
  useEffect(() => {
    const rid = instance?.ludusRangeId
    if (!isRunning) {
      // Only clear auto-tab latching after a task actually finished — not on the
      // initial paint while resumeTask is still fetching (that would undo a
      // readInitialGoadTab() of "deploy" and leave the user stuck on Terminal).
      if (wasGoadRunningRef.current) autoTabRef.current = false
      wasGoadRunningRef.current = false
      // Start a buffer-replay stream when no task is running so the last
      // deploy's logs remain visible after page refresh or navigation.
      // snapshotStart: false replays the Ludus log buffer from the beginning
      // of the last run. runAction() clears these and restarts with
      // snapshotStart: true when a new deploy begins, so this doesn't
      // interfere with fresh deploys.
      if (rid && !isRangeStreaming) {
        void (async () => {
          const historyAnchor = await fetchDeployElapsedAnchorMs((id) => ludusApi.getRangeLogHistory(id), rid)
          startRangeStreaming(rid, {
            snapshotStart: false,
            ...(historyAnchor != null ? { deployElapsedAnchorMs: historyAnchor } : {}),
          })
        })()
      }
      return
    }
    wasGoadRunningRef.current = true
    // Determine whether the running action is a deploy-class action.
    // For fresh runs, currentAction is set by runAction() directly.
    // For cross-browser/impersonation resumes, resumedAsDeployRef is set by
    // the server-side resume fallback after inspecting the task command — no
    // sessionStorage needed.
    const isDeployAction = currentAction
      ? DEPLOY_TAB_ACTIONS.has(currentAction)
      : resumedAsDeployRef.current

    // Start range streaming as soon as we have both a running task AND a known rangeId.
    // We watch both `isRunning` and `instance?.ludusRangeId` because the two values
    // arrive at different times:
    //   • isRunning goes true quickly (server-side resume fires on mount)
    //   • instance.ludusRangeId arrives later (fetchInstances is async)
    // Without this dual dep, the effect would fire while instance is still null and
    // never restart once the data loads — resulting in "Waiting for output..." forever.
    //
    // snapshotStart: false — after refresh/re-enter, omit skipping the first Ludus
    // snapshot; otherwise the panel stays empty until the next *new* line (History
    // still shows prior output).
    if (isDeployAction && rid && !isRangeStreaming) {
      void (async () => {
        const historyAnchor = await fetchDeployElapsedAnchorMs((id) => ludusApi.getRangeLogHistory(id), rid)
        startRangeStreaming(rid, {
          snapshotStart: false,
          ...(historyAnchor != null ? { deployElapsedAnchorMs: historyAnchor } : {}),
        })
      })()
    }

    if (!autoTabRef.current && isDeployAction) {
      autoTabRef.current = true
      setActiveTab("deploy")
    }

    // Fallback: deploy hint missing but a GOAD task is still running and
    // Ludus is deploying — still stream + Deploy tab.
    if (!isDeployAction && rid && !isRangeStreaming) {
      let cancelled = false
      void (async () => {
        try {
          const res = await fetch(
            `/api/range/pb-status?rangeId=${encodeURIComponent(rid)}`,
            { cache: "no-store" },
          )
          if (!res.ok || cancelled) return
          const data = (await res.json()) as { rangeState?: string }
          const rs = String(data.rangeState ?? "").toUpperCase()
          if (rs !== "DEPLOYING" && rs !== "WAITING") return
          if (cancelled || isRangeStreamingRef.current) return
          const historyAnchor = await fetchDeployElapsedAnchorMs((id) => ludusApi.getRangeLogHistory(id), rid)
          startRangeStreaming(rid, {
            snapshotStart: false,
            ...(historyAnchor != null ? { deployElapsedAnchorMs: historyAnchor } : {}),
          })
          if (!autoTabRef.current) {
            autoTabRef.current = true
            setActiveTab("deploy")
          }
        } catch {
          /* ignore */
        }
      })()
      return () => {
        cancelled = true
      }
    }
  // Intentionally omits streaming callbacks and action-state vars — they are
  // stable refs or change in response to the same triggers. Re-registering on
  // every state change would cause double-starts of the range log stream.
  }, [isRunning, instance?.ludusRangeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // On page load / refresh OR when a new task starts: read the server-persisted
  // phase to restore postProcessingStep, and sync the timer from task.startedAt.
  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/goad/tasks/${taskId}`)
        if (!res.ok || cancelled) return
        const data = await res.json() as {
          phase?: "network-deploy" | null
          startedAt?: number
        }
        if (cancelled) return
        // Use server-persisted startedAt so the timer survives page refresh.
        if (data.startedAt) setGoadStreamStartedAt(data.startedAt)
        // Only restore the deploying state — "network-pending" is no longer
        // shown proactively; the pipeline appears only when Branch A actually
        // fires (YAML was wrong after GOAD and a tag deploy is needed).
        if (data.phase === "network-deploy") {
          setPostProcessingStep("network-deploying")
        }
      } catch { /* best-effort */ }
    })()
    return () => { cancelled = true }
  // Only re-run when taskId changes — the setter functions are stable and
  // don't need to be in the dep list.
  }, [taskId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Server-side resume: on mount, reconnect GOAD task SSE so logs show after
  // redirect from goad/new (execute stream is abandoned on navigation).
  useEffect(() => {
    if (!instanceId) return
    let cancelled = false
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 50))
        if (cancelled || taskIdRef.current) return

        const urlTaskId = new URLSearchParams(window.location.search)
          .get("goadTaskId")
          ?.trim()
        if (urlTaskId) {
          resumedAsDeployRef.current = true
          await resumeTask(urlTaskId)
          return
        }

        const findRunning = async (): Promise<GoadTaskForCorrelation | undefined> => {
          const res = await fetch("/api/goad/tasks", {
            credentials: "include",
            headers: impersonationHeaders(),
          })
          if (!res.ok) return undefined
          const data = (await res.json()) as { tasks: GoadTaskForCorrelation[] }
          return (data.tasks ?? []).find(
            (t) => t.instanceId === instanceId && t.status === "running",
          )
        }

        const deadline = Date.now() + 20_000
        while (Date.now() < deadline && !cancelled && !taskIdRef.current) {
          const running = await findRunning()
          if (running) {
            resumedAsDeployRef.current = isDeployActionCommand(running.command)
            await resumeTask(running.id)
            return
          }
          await new Promise((r) => setTimeout(r, 500))
        }
      } catch { /* best-effort */ }
    })()
    return () => { cancelled = true }
  // Only re-run when instanceId changes — resumeTask and impersonationHeaders
  // are stable and including them would cause spurious re-resume attempts.
  }, [instanceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wizard post-deploy effect: after a wizard-initiated GOAD task finishes,
  // apply the network rules the user defined in the wizard (stored server-side
  // before the redirect because GOAD's install process overwrites range-config).
  useEffect(() => {
    if (exitCode === null || !instance?.ludusRangeId || !instance?.instanceId) return
    if (wizardNetworkHandledRef.current) return
    const rangeId = instance.ludusRangeId
    const id = instance.instanceId
    void (async () => {
      try {
        const res = await fetch(`/api/goad/instances/${encodeURIComponent(id)}/pending-network`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...impersonationHeaders() },
          body: JSON.stringify({ __luxConsumePendingNetwork: true }),
          cache: "no-store",
        })
        if (!res.ok) return
        const data = await res.json() as { snapshot: NetworkSnapshot | null }
        const snapshot = data.snapshot
        if (!snapshot) {
          wizardNetworkHandledRef.current = true
          return
        }
        if (wizardNetworkHandledRef.current) return
        wizardNetworkHandledRef.current = true

        const completedId = taskIdRef.current
        setPostProcessingStep("network-deploying")
        postProcessingRef.current = true
        if (completedId) {
          await fetch(`/api/goad/tasks/${completedId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hasNetworkRules: true, phase: "network-deploy" }),
          }).catch(() => {})
        }

        try {
          const current = await ludusApi.getRangeConfig(rangeId)
          const yaml = current.data?.result
          if (yaml && !networkSectionEqual(yaml, snapshot)) {
            const merged = applyNetworkSection(yaml, snapshot)
            await ludusApi.setRangeConfig(merged, rangeId)
          }
          // Match runAction / startNetworkTagDeploy: do not start a tag deploy while
          // Ludus is still in DEPLOYING/WAITING from GOAD's internal range deploy.
          await waitUntilLudusRangeNotDeploying(() => ludusApi.getRangeStatus(rangeId), {
            pollMs: 5_000,
            absoluteMaxMs: LUDUS_WAIT_ABSOLUTE_MAX_MS,
          })
          for (let attempt = 0; attempt < 3; attempt++) {
            const tagRunAt = Date.now()
            const dep = await ludusApi.deployRange(["network"], undefined, rangeId)
            if (!dep.error) {
              await registerLuxDeployTagRun(rangeId, ["network"], tagRunAt)
              const nw = await waitForNetworkTagDeployCompletion({
                rangeId,
                requestedAtMs: tagRunAt,
                fetchHistory: () => ludusApi.getRangeLogHistory(rangeId),
                fetchStatus: () => ludusApi.getRangeStatus(rangeId),
                pollMs: 5_000,
                absoluteMaxMs: LUDUS_WAIT_ABSOLUTE_MAX_MS,
              })
              if (!nw.ok) {
                console.warn("[LUX] post-GOAD network tag wait:", nw.via, nw.detail)
              }
              await fetch("/api/range/reconcile-pb", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json", ...impersonationHeaders() },
                body: JSON.stringify({ rangeId }),
              }).catch(() => {})
              break
            }
            if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
          }
        } finally {
          postProcessingRef.current = false
          if (completedId) {
            await fetch(`/api/goad/tasks/${completedId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phase: null }),
            }).catch(() => {})
          }
          setPostProcessingStep("idle")
        }
      } catch { /* best-effort */ }
    })()
  }, [exitCode, instance?.instanceId, instance?.ludusRangeId, impersonationHeaders])

  const [reprovisioningExtension, setReprovisioningExtension] = useState<string | null>(null)
  const [removingExtension, setRemovingExtension] = useState<string | null>(null)
  const [inventories, setInventories] = useState<InstanceInventoryFile[]>([])
  const [inventoriesLoading, setInventoriesLoading] = useState(false)
  const [inventoriesError, setInventoriesError] = useState<string | null>(null)
  const [selectedInventoryName, setSelectedInventoryName] = useState<string | null>(null)

  // ── Admin state ───────────────────────────────────────────────────────────
  const [isAdmin, setIsAdmin] = useState(() => !!shell?.isAdmin)
  useEffect(() => {
    if (shell) {
      setIsAdmin(shell.isAdmin)
      return
    }
    try {
      if (sessionStorage.getItem("ludus-sidebar-is-admin") === "true") { setIsAdmin(true); return }
    } catch { /* ignore */ }
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => { if (d?.isAdmin) setIsAdmin(true) })
      .catch(() => {})
  }, [shell])

  // ── Reassign dialog ───────────────────────────────────────────────────────
  const [showReassign, setShowReassign] = useState(false)
  const [reassignUsers, setReassignUsers] = useState<{ userID: string }[]>([])
  const [reassignTargetUser, setReassignTargetUser] = useState("")
  const [reassignTargetRange, setReassignTargetRange] = useState("")
  const [reassigning, setReassigning] = useState(false)

  const openReassignDialog = async () => {
    setReassignTargetUser("")
    setReassignTargetRange(instance?.ludusRangeId ?? "")
    setShowReassign(true)
    if (reassignUsers.length === 0) {
      try {
        const res = await fetch("/api/admin/ranges-data")
        if (res.ok) {
          const data = await res.json()
          setReassignUsers((data.users ?? []).sort((a: { userID: string }, b: { userID: string }) => a.userID.localeCompare(b.userID)))
        }
      } catch { /* best-effort */ }
    }
  }

  const handleReassign = async () => {
    if (!reassignTargetUser) return
    setReassigning(true)
    try {
      const res = await fetch("/api/goad/instances/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId,
          targetUserId: reassignTargetUser,
          rangeId: reassignTargetRange.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok && res.status !== 207) {
        toast({ variant: "destructive", title: "Reassign failed", description: data.error ?? `HTTP ${res.status}` })
      } else if (data.errors?.length) {
        toast({
          title: "Reassigned (with warnings)",
          description: data.errors.join("; "),
          variant: "destructive",
        })
        setShowReassign(false)
        fetchInstances()
      } else {
        toast({ title: "Instance reassigned", description: `Now owned by ${reassignTargetUser}` })
        setShowReassign(false)
        fetchInstances()
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Reassign error", description: (err as Error).message })
    } finally {
      setReassigning(false)
    }
  }

  const fetchInstances = useCallback(async () => {
    const isInitial = !initialInstanceLoadDone.current
    if (isInitial) setLoading(true)
    else setRefreshing(true)
    try {
      const response = await fetch("/api/goad/instances", { headers: impersonationHeaders() })
      const data = await response.json()
      if (!response.ok || data.error) {
        console.warn("GOAD instances fetch error:", data.error)
      } else if (Array.isArray(data.instances)) {
        const found = data.instances.find(
          (i: GoadInstance) => i.instanceId === instanceId
        )
        setInstance(found || null)
        initialInstanceLoadDone.current = true
      }
    } catch (e) {
      console.warn("GOAD instances fetch exception:", e)
    }
    if (isInitial) setLoading(false)
    else setRefreshing(false)
  }, [instanceId, impersonationHeaders]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchInventories = useCallback(async () => {
    setInventoriesLoading(true)
    setInventoriesError(null)
    try {
      const res = await fetch(
        `/api/goad/instances/${encodeURIComponent(instanceId)}/inventories`,
        { headers: impersonationHeaders() }
      )
      const data = await res.json()
      if (!res.ok) {
        setInventoriesError(data.error || "Failed to load inventories")
        setInventories([])
      } else {
        setInventories(data.inventories ?? [])
        if (data.inventories?.length && !selectedInventoryName) {
          setSelectedInventoryName(data.inventories[0].name)
        }
      }
    } catch (e) {
      setInventoriesError((e as Error).message)
      setInventories([])
    }
    setInventoriesLoading(false)
  // Omits `selectedInventoryName` setter — stable; adding it would cause the
  // callback to be recreated whenever selection changes, breaking memoization.
  }, [instanceId, impersonationHeaders]) // eslint-disable-line react-hooks/exhaustive-deps

  const copyInventoryToClipboard = (content: string, name: string) => {
    navigator.clipboard.writeText(content).then(
      () => toast({ title: "Copied", description: `${name} copied to clipboard` }),
      () => toast({ title: "Copy failed", variant: "destructive" })
    )
  }

  const downloadInventory = (content: string, name: string) => {
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const fetchTaskHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch("/api/goad/tasks", { headers: impersonationHeaders() })
      const data = await res.json()
      const allTasks: GoadTaskForCorrelation[] = data.tasks ?? []
      setTaskHistory(allTasks.filter((t) =>
        t.instanceId === instanceId || t.command.includes(instanceId)
      ))
    } catch (err) {
      console.warn("[goad-instance] fetchTaskHistory failed:", (err as Error).message)
    }
    setHistoryLoading(false)
  // Omits setter functions — all stable; only re-create when the instance or
  // impersonation scope changes.
  }, [instanceId, impersonationHeaders]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDeployHistory = useCallback(async () => {
    if (!instance?.ludusRangeId) return
    setDeployHistoryLoading(true)
    try {
      const result = await ludusApi.getRangeLogHistory(instance.ludusRangeId)
      setDeployHistory(extractArray<LogHistoryEntry>(result.data as unknown))
    } catch (err) {
      console.warn("[goad-instance] fetchDeployHistory failed:", (err as Error).message)
    }
    setDeployHistoryLoading(false)
  }, [instance?.ludusRangeId])

  const fetchLogMarkerEnrichment = useCallback(async () => {
    const rid = instance?.ludusRangeId?.trim()
    if (!rid) {
      setLogMarkerEnrichment(null)
      return
    }
    try {
      const res = await fetch(`/api/range/log-enrichment?rangeId=${encodeURIComponent(rid)}`, {
        credentials: "include",
        headers: { ...impersonationHeaders() },
      })
      if (!res.ok) setLogMarkerEnrichment(null)
      else setLogMarkerEnrichment((await res.json()) as RangeLogMarkerEnrichment)
    } catch {
      setLogMarkerEnrichment(null)
    }
  }, [instance?.ludusRangeId, impersonationHeaders])

  const fetchAllHistory = useCallback(async () => {
    await Promise.all([fetchTaskHistory(), fetchDeployHistory(), fetchLogMarkerEnrichment()])
  }, [fetchTaskHistory, fetchDeployHistory, fetchLogMarkerEnrichment])

  const handleSelectHistoryEntry = useCallback(async (entry: CorrelatedHistoryEntry) => {
    setSelectedHistoryEntry(entry)
    setHistoryDeployLines([])
    setHistoryGoadLines([])
    setHistoryDetailLoading(true)

    const promises: Promise<void>[] = []

    if (entry.deployEntry && instance?.ludusRangeId) {
      const deploys =
        entry.mergedBatchDeploys && entry.mergedBatchDeploys.length > 0
          ? [...entry.mergedBatchDeploys].sort(
              (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
            )
          : [entry.deployEntry]
      promises.push(
        (async () => {
          const lines: string[] = []
          for (const d of deploys) {
            const result = await ludusApi.getRangeLogHistoryById(d.id, instance.ludusRangeId)
            if (result.data?.result) {
              if (deploys.length > 1) lines.push(`--- Ludus range deploy ${d.id} ---`)
              const raw = result.data.result.split("\n").filter((l) => l.trim())
              lines.push(...augmentLudusDeployHistoryLines(raw, d.start, d.end))
            }
          }
          setHistoryDeployLines(lines)
        })(),
      )
    }

    if (entry.goadTask) {
      promises.push(
        fetchGoadTaskLogLines(entry.goadTask.id, impersonationHeaders()).then((lines) => {
          setHistoryGoadLines(lines)
        }),
      )
    }

    await Promise.allSettled(promises)
    setHistoryDetailLoading(false)
  }, [instance?.ludusRangeId, impersonationHeaders])

  const clearHistorySelection = useCallback(() => {
    setSelectedHistoryEntry(null)
    setHistoryDeployLines([])
    setHistoryGoadLines([])
  }, [])

  const refreshAnsibleInstalled = useCallback(async () => {
    setAnsibleInstalledLoading(true)
    try {
      const res = await ludusApi.listAnsible()
      if (res.error) throw new Error(res.error)
      setAnsibleInstalled(parseAnsibleInstalledSets(res.data ?? []))
    } catch {
      setAnsibleInstalled({ roles: new Set(), collections: new Set() })
    } finally {
      setAnsibleInstalledLoading(false)
    }
  }, [])

  // Fetch instance data, catalog, and Ludus templates when instanceId / impersonation changes
  useEffect(() => {
    fetchInstances()
    fetch("/api/goad/catalog", { method: "POST", credentials: "include" })
      .then((r) => r.json())
      .then((d: GoadCatalog) => { if (d.configured) setCatalog(d) })
      .catch(() => {})
    fetch("/api/proxy/templates")
      .then((r) => r.ok ? r.json() : [])
      .then((d) => {
        setTemplates(extractArray<TemplateObject>(d))
      })
      .catch(() => {})
  // `fetchInstances` is a useCallback that already captures instanceId and
  // impersonationHeaders — it is the right trigger for the whole block.
  // The direct fetch calls inside are intentionally stable one-shots.
  }, [fetchInstances]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === "extensions") void refreshAnsibleInstalled()
  }, [activeTab, refreshAnsibleInstalled])

  useEffect(() => {
    if (activeTab === "history") fetchAllHistory()
  }, [activeTab, fetchAllHistory])

  // Deep-link: /goad/{id}?tab=history&deployLogId=… → open History and select entry.
  useEffect(() => {
    const tab = searchParams.get("tab")
    const deployLogId = searchParams.get("deployLogId")
    if (!deployLogId) {
      historyUrlHandledRef.current = null
      return
    }
    const rangeIdForDeepLink = instance?.ludusRangeId
    if (tab !== "history" || !rangeIdForDeepLink) return
    if (historyUrlHandledRef.current === deployLogId) return
    historyUrlHandledRef.current = deployLogId

    let cancelled = false
    void (async () => {
      setActiveTab("history")
      const [deployResult, tasksRes] = await Promise.all([
        ludusApi.getRangeLogHistory(rangeIdForDeepLink),
        fetch("/api/goad/tasks", { headers: impersonationHeaders() }).then((r) => r.json()),
      ])
      if (cancelled) return
      const dh = extractArray<LogHistoryEntry>(deployResult.data as unknown)
      const allTasks = (tasksRes.tasks ?? []) as GoadTaskForCorrelation[]
      const th = allTasks.filter(
        (t) => t.instanceId === instanceId || t.command.includes(instanceId),
      )
      let entry: CorrelatedHistoryEntry | undefined = correlateHistoryEntries(dh, th).find(
        (c) =>
          c.deployEntry?.id === deployLogId ||
          (c.mergedBatchDeploys?.some((x) => x.id === deployLogId) ?? false),
      )
      if (!entry) {
        const d = dh.find((x) => x.id === deployLogId)
        if (d) {
          entry = {
            deployEntry: d,
            sortTime: new Date(d.start).getTime(),
            kind: "ludus_only",
          }
        }
      }
      if (entry && !cancelled) await handleSelectHistoryEntry(entry)
      if (!cancelled) {
        router.replace(`/goad/${encodeURIComponent(instanceId)}?tab=history`, { scroll: false })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [searchParams.toString(), instance?.ludusRangeId, instanceId, impersonationHeaders, router, handleSelectHistoryEntry])

  const { runAction } = useGoadRunAction({
    instance,
    instanceId,
    impersonation,
    impersonationHeaders,
    scopeTag,
    queryClient,
    taskIdRef,
    postProcessingRef,
    setCurrentAction,
    setActiveTab,
    setPostProcessingStep,
    clear,
    clearRangeLogs,
    startRangeStreaming,
    run,
    toast,
    fetchInstances,
  })

  const {
    syncingIps,
    handleStart,
    handleStop,
    requestAbort,
    handleProvide,
    handleProvisionLab,
    handleInstallProvideProvision,
    handleStatus,
    handleSyncIps,
    handleInstallExtension,
    handleReprovisionExtension,
    handleRemoveExtension,
    handleDestroy,
    handleDeleteInstanceOnly,
  } = useGoadInstanceActionHandlers({
    instance,
    instanceId,
    catalog,
    runAction,
    confirm,
    toast,
    impersonationHeaders,
    scopeTag,
    goadListQueryBucket,
    queryClient,
    router,
    taskId,
    setInitializingRange,
    setReprovisioningExtension,
    setRemovingExtension,
    stop,
    stopRangeStreaming,
    abortRangeUnified,
    refreshRangeStateFromServer,
    fetchInstances,
    refreshRanges,
  })
  const labInfo: GoadLabDef | undefined = catalog?.labs.find((l) => l.name === instance?.lab)
  const extMap: Record<string, GoadExtensionDef> = Object.fromEntries(
    (catalog?.extensions ?? []).map((e) => [e.name, e])
  )
  const uninstalledExtensions: GoadExtensionDef[] = (catalog?.extensions ?? []).filter((ext) => {
    if (instance?.extensions?.includes(ext.name)) return false
    if (!instance?.lab) return true
    return ext.compatibility.includes("*") || ext.compatibility.includes(instance.lab)
  })
  const provisionOnlyExtensionsSupported = goadSupportsProvisionOnlyExtensions(catalog)
  const hasZeroVmExtensionsToInstall = uninstalledExtensions.some(extensionIsProvisionOnly)

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!instance) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/goad"><ArrowLeft className="h-4 w-4" /> Back</Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>Instance &quot;{instanceId}&quot; not found</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 basis-0 gap-6 w-full overflow-hidden">
      <GoadReassignDialog
        open={showReassign}
        instance={instance}
        reassignUsers={reassignUsers}
        reassignTargetUser={reassignTargetUser}
        reassignTargetRange={reassignTargetRange}
        reassigning={reassigning}
        onClose={() => setShowReassign(false)}
        onTargetUserChange={setReassignTargetUser}
        onTargetRangeChange={setReassignTargetRange}
        onSubmit={handleReassign}
      />
      <GoadInstanceHeader
        instance={instance}
        loading={loading}
        refreshing={refreshing}
        onRefresh={fetchInstances}
      />
      <GoadInstanceActionBar
        instance={instance}
        isAdmin={isAdmin}
        isRunning={isRunning}
        isAborting={isAborting}
        initializingRange={initializingRange}
        syncingIps={syncingIps}
        currentAction={currentAction}
        rangeState={rangeState}
        pendingAction={pendingAction}
        commitConfirm={commitConfirm}
        cancelConfirm={cancelConfirm}
        onInstallProvideProvision={handleInstallProvideProvision}
        onProvide={handleProvide}
        onProvisionLab={handleProvisionLab}
        onSyncIps={handleSyncIps}
        onStart={handleStart}
        onStop={handleStop}
        onStatus={handleStatus}
        onAbort={requestAbort}
        onOpenReassign={openReassignDialog}
        onDeleteInstanceOnly={handleDeleteInstanceOnly}
        onDestroy={handleDestroy}
      />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <GoadInstanceTabTriggers
          activeTab={activeTab}
          isRunning={isRunning}
          isRangeStreaming={isRangeStreaming}
          extensionCount={instance.extensions.length}
          inventoryCount={inventories.length}
          inventoriesLoading={inventoriesLoading}
          onInventoriesOpen={() => inventories.length === 0 && !inventoriesLoading && fetchInventories()}
          onHistoryOpen={fetchAllHistory}
        />
        <GoadDeployTab
          instance={instance}
          instanceId={instanceId}
          isRunning={isRunning}
          isRangeStreaming={isRangeStreaming}
          rangeState={rangeState}
          currentAction={currentAction}
          exitCode={exitCode}
          lines={lines}
          rangeLogLines={rangeLogLines}
          clear={clear}
          clearRangeLogs={clearRangeLogs}
          handleRefreshRangeLogs={handleRefreshRangeLogs}
          rangeLogRefreshBusy={rangeLogRefreshBusy}
          rangeElapsed={rangeElapsed}
          goadElapsed={goadElapsed}
          postProcessingStep={postProcessingStep}
        />
        <GoadTerminalTab
          active={activeTab === "terminal"}
          instanceId={instanceId}
          lines={lines}
          isRunning={isRunning}
          currentAction={currentAction}
          taskId={taskId}
          exitCode={exitCode}
          clear={clear}
        />
        <GoadInfoTab
          instance={instance}
          instanceId={instanceId}
          labInfo={labInfo}
          onViewInventories={() => {
            setActiveTab("inventories")
            if (inventories.length === 0 && !inventoriesLoading) fetchInventories()
          }}
        />
        <GoadInventoriesTab
          active={activeTab === "inventories"}
          instanceId={instanceId}
          inventories={inventories}
          inventoriesLoading={inventoriesLoading}
          inventoriesError={inventoriesError}
          selectedInventoryName={selectedInventoryName}
          setSelectedInventoryName={setSelectedInventoryName}
          fetchInventories={fetchInventories}
          copyInventoryToClipboard={copyInventoryToClipboard}
          downloadInventory={downloadInventory}
        />
        <GoadExtensionsTab
          active={activeTab === "extensions"}
          instance={instance}
          extMap={extMap}
          uninstalledExtensions={uninstalledExtensions}
          builtNames={builtNames}
          allNames={allNames}
          provisionOnlyExtensionsSupported={provisionOnlyExtensionsSupported}
          isRunning={isRunning}
          pendingAction={pendingAction}
          commitConfirm={commitConfirm}
          cancelConfirm={cancelConfirm}
          reprovisioningExtension={reprovisioningExtension}
          removingExtension={removingExtension}
          onReprovisionExtension={handleReprovisionExtension}
          onRemoveExtension={handleRemoveExtension}
          onInstallExtension={handleInstallExtension}
          ansibleInstalled={ansibleInstalled}
          ansibleInstalledLoading={ansibleInstalledLoading}
          onAnsibleInstalledChange={refreshAnsibleInstalled}
        />
        <GoadHistoryTab
          active={activeTab === "history"}
          instanceId={instanceId}
          ludusRangeId={instance.ludusRangeId}
          selectedHistoryEntry={selectedHistoryEntry}
          historyDetailLoading={historyDetailLoading}
          historyDeployLines={historyDeployLines}
          historyGoadLines={historyGoadLines}
          historyLoading={historyLoading}
          deployHistoryLoading={deployHistoryLoading}
          deployHistory={deployHistory}
          taskHistory={taskHistory}
          logMarkerEnrichment={logMarkerEnrichment}
          onClearSelection={clearHistorySelection}
          onFetchAllHistory={fetchAllHistory}
          onSelectHistoryEntry={handleSelectHistoryEntry}
          onCopyDeployLogId={(id) => {
            void navigator.clipboard.writeText(id)
            toast({ title: "Copied", description: "Deploy log id copied" })
          }}
          onCopyTaskId={(id) => {
            void navigator.clipboard.writeText(id)
            toast({ title: "Copied", description: "Task id copied" })
          }}
        />
      </Tabs>
    </div>
  )
}

export function GoadInstancePageClient() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <GoadInstancePage />
    </Suspense>
  )
}
