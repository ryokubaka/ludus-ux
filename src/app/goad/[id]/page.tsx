"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useDeployLogContext } from "@/lib/deploy-log-context"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { GoadTerminal, useGoadStream } from "@/components/goad/goad-terminal"
import {
  ArrowLeft,
  Terminal,
  Play,
  StopCircle,
  Trash2,
  Power,
  PowerOff,
  Puzzle,
  Plus,
  Loader2,
  RefreshCw,
  Wifi,
  Server,
  CheckCircle2,
  Package,
  Wrench,
  History,
  Clock,
  User,
  UserCog,
  RotateCcw,
  FileText,
  Copy,
  Download,
  X,
  Activity,
  MapPin,
  HardDriveDownload,
  Check,
  CircleAlert,
  PackageX,
  AlertTriangle,
  Info,
  Shield,
} from "lucide-react"
import type {
  GoadInstance,
  GoadCatalog,
  GoadExtensionDef,
  GoadLabDef,
  TemplateObject,
  LogHistoryEntry,
} from "@/lib/types"
import { ludusApi, postVmOperationAudit, pruneKnownHosts } from "@/lib/api"
import { matchingVmIdsForExtension } from "@/lib/extension-vm-match"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import type { InstanceInventoryFile } from "@/lib/goad-ssh"
import { cn, extractArray, timeAgo } from "@/lib/utils"
import { augmentLudusDeployHistoryLines } from "@/lib/log-line-timestamp"
import { useElapsed } from "@/hooks/use-elapsed"
import { useToast } from "@/hooks/use-toast"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import {
  CorrelatedHistoryRow,
  formatLogHistoryLocalRange,
  formatLogHistoryDuration,
} from "@/components/range/log-history-list"
import { useImpersonation } from "@/lib/impersonation-context"
import { useRange } from "@/lib/range-context"
import {
  type CorrelatedHistoryEntry,
  type GoadTaskForCorrelation,
  correlateHistoryEntries,
  aggregateDeployStatuses,
} from "@/lib/goad-deploy-history-correlation"
import { extractNetworkSection, applyNetworkSection, removeExtensionVmsFromRangeConfig, hasNetworkRules, networkSectionEqual } from "@/lib/network-rules"
import { clearRangeAborting } from "@/lib/range-aborting"
import { useAbortRange } from "@/lib/use-abort-range"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { useShellSession } from "@/components/providers/shell-session-provider"

// ── Template readiness helpers ────────────────────────────────────────────────

function checkTemplates(required: string[], builtNames: Set<string>, allNames: Set<string>) {
  const present: string[] = []
  const missingUnbuilt: string[] = []
  const missingAbsent: string[] = []
  for (const t of required) {
    if (builtNames.has(t)) present.push(t)
    else if (allNames.has(t)) missingUnbuilt.push(t)
    else missingAbsent.push(t)
  }
  return { present, missingUnbuilt, missingAbsent, ready: missingUnbuilt.length === 0 && missingAbsent.length === 0 }
}

function TemplateChips({
  required,
  builtNames,
  allNames,
}: {
  required: string[]
  builtNames: Set<string>
  allNames: Set<string>
}) {
  if (required.length === 0) return null
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {required.map((t) => {
          const built = builtNames.has(t)
          const installed = allNames.has(t)
          const chip = (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border",
                built
                  ? "bg-green-500/10 border-green-500/30 text-green-400"
                  : installed
                  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              )}
            >
              {built
                ? <Check className="h-2.5 w-2.5 flex-shrink-0" />
                : installed
                ? <CircleAlert className="h-2.5 w-2.5 flex-shrink-0" />
                : <PackageX className="h-2.5 w-2.5 flex-shrink-0" />}
              {t}
            </span>
          )
          if (built) {
            return (
              <Tooltip key={t}>
                <TooltipTrigger asChild>{chip}</TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="border-green-500/30 bg-green-950/90 text-green-300 text-xs px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-green-400 flex-shrink-0" />
                    <span><span className="font-mono font-semibold">{t}</span> — installed &amp; built</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          }
          return (
            <span
              key={t}
              title={installed ? "Installed but not yet built — go to Templates to build" : "Not installed — go to Templates to add"}
            >
              {chip}
            </span>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

function formatTaskInstant(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatDuration(startedAt: number, endedAt?: number): string {
  const ms = (endedAt ?? Date.now()) - startedAt
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Tab classification for Ludus range deploy vs GOAD-terminal-only actions. */
const DEPLOY_TAB_ACTIONS = new Set(["provide", "install", "install-extension", "provision-lab"])
const TERMINAL_TAB_ACTIONS = new Set(["provision-extension"])

const GOAD_INSTANCE_TAB_IDS = new Set([
  "deploy",
  "terminal",
  "info",
  "inventories",
  "extensions",
  "history",
])

/** Legacy / mistaken query values → a real `TabsTrigger` value (`logs` had no trigger). */
function normalizeGoadInstanceTab(tab: string): string {
  if (tab === "logs") return "deploy"
  if (GOAD_INSTANCE_TAB_IDS.has(tab)) return tab
  return "deploy"
}

/** First paint: URL ?tab= wins (normalized); otherwise default to "deploy". */
function readInitialGoadTab(): string {
  if (typeof window === "undefined") return "deploy"
  try {
    const raw = new URLSearchParams(window.location.search).get("tab")
    if (raw) return normalizeGoadInstanceTab(raw)
  } catch {
    /* ignore */
  }
  return "deploy"
}

/**
 * True when a GOAD command string corresponds to a deploy-class action (one
 * that triggers a Ludus range deploy and should land on the Deploy Status tab).
 * Replaces the old sessionStorage `actionStorageKey` approach so that action
 * type is derived from the server-stored task command — no browser state needed.
 */
function isDeployActionCommand(command: string): boolean {
  return /;\s*(provide|install_extension|provision_lab)\b/.test(command)
}

function GoadInstancePage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const shell = useShellSession()
  const queryClient = useQueryClient()
  const instanceId = decodeURIComponent(params.id as string)
  /**
   * GOAD actions that (re)generate Ludus range-config YAML from GOAD templates and
   * would therefore wipe the user's `network:` block (firewall rules + defaults).
   *
   * Preservation is a three-step sandwich — step 1 is the one that actually
   * prevents the rules from being wiped, steps 2-3 are the safety net:
   *
   *   1. PRE-INJECT — before we even launch GOAD, push the current `network:`
   *      block into the GOAD workspace Ludus config (typically
   *      `workspace/<id>/provider/config.yml`; legacy `providers/ludus/config.yml`)
   *      over SSH (see `/api/goad/instances/[id]/sync-network`). GOAD then
   *      calls `ludus range config set -f config.yml` from that directory with our block
   *      already inside, so Ludus' range-config.yml is NEVER written without
   *      the firewall rules and the Ansible deploy that follows applies
   *      iptables correctly from the start. This eliminates the window where
   *      the old post-only approach would briefly flush iptables.
   *
   *   2. POST-RESTORE — after GOAD returns, PUT the snapshot back to Ludus
   *      range-config anyway. Catches `provide`, which regenerates
   *      config.yml from templates and may drop the injection.
   *
   *   3. NETWORK-TAG DEPLOY — if step 2 actually changed the config, trigger
   *      `deployRange(["network"])` so iptables on the router is rebuilt
   *      from the now-correct config. No-op if step 1 worked.
   *
   * All three steps happen regardless of GOAD's exit code: even a failed
   * GOAD run can have already PUT a network-less YAML before bailing out.
   *
   * `provision-extension` is included because some extensions regenerate the
   * range YAML during their Ansible run (observed empirically); restoring is
   * a no-op when nothing changed.
   */
  const RANGE_YAML_TOUCHING_ACTIONS = new Set([
    "provide",
    "install",
    "install-extension",
    "provision-lab",
    "provision-extension",
  ])

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
    requestAnimationFrame(() => {
      startRangeStreaming(rid, { snapshotStart: false })
      void refreshRangeStateFromServer(rid)
    })
    window.setTimeout(() => {
      rangeLogRefreshLock.current = false
      setRangeLogRefreshBusy(false)
    }, 750)
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

  // Range log timer: prefer the server-persisted GOAD task start time so it
  // survives refresh; fall back to context's streamStartedAt for non-GOAD deploys.
  const rangeElapsed = useElapsed(isRangeStreaming ? (goadStreamStartedAt ?? rangeStreamStartedAt) : null)
  const goadElapsed = useElapsed(goadStreamStartedAt)

  const [catalog, setCatalog] = useState<GoadCatalog | null>(null)
  const [taskHistory, setTaskHistory] = useState<GoadTaskForCorrelation[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [deployHistory, setDeployHistory] = useState<LogHistoryEntry[]>([])
  const [deployHistoryLoading, setDeployHistoryLoading] = useState(false)
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<CorrelatedHistoryEntry | null>(null)
  const [historyDeployLines, setHistoryDeployLines] = useState<string[]>([])
  const [historyGoadLines, setHistoryGoadLines] = useState<string[]>([])
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false)
  const [activeTab, setActiveTab] = useState(() => readInitialGoadTab())
  const [templates, setTemplates] = useState<TemplateObject[]>([])
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
  const [postProcessingStep, setPostProcessingStep] = useState<"idle" | "network-pending" | "network-deploying">("idle")
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
  // infrastructure (which would otherwise keep the command alive for 30–90 min).
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
  }, [rangeState, isRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  // Watchdog B: GOAD exited but the range is still stuck in DEPLOYING.
  // Route through the unified abort hook so it goes through Ludus (user →
  // admin) and falls back to PocketBase if the goroutine has already exited.
  // Skip if postProcessingRef is set: runAction intentionally launched a
  // network-tag deploy AFTER GOAD finished — that's the DEPLOYING we see.
  useEffect(() => {
    if (exitCode === null || !instance?.ludusRangeId) return
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
      description: "GOAD exited with an error while the range was still deploying. Resetting the range state automatically.",
    })
  }, [exitCode, rangeState, instance?.ludusRangeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Read ?tab=<value> from the URL on first mount (e.g. redirected from goad/new)
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab")
    if (tab) setActiveTab(normalizeGoadInstanceTab(tab))
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
        startRangeStreaming(rid, { snapshotStart: false })
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
      startRangeStreaming(rid, { snapshotStart: false })
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
          startRangeStreaming(rid, { snapshotStart: false })
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
  }, [taskId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Server-side resume: on mount, query /api/goad/tasks for any running task on
  // this instance and call resumeTask() so GOAD logs are visible across browsers,
  // incognito sessions, and admin impersonation without any browser-local state.
  useEffect(() => {
    if (!instanceId) return
    let cancelled = false
    void (async () => {
      try {
        // Short wait so React can finish its initial render pass; if taskId is
        // already set (e.g. from a same-tab run that never unmounted) we skip.
        await new Promise((r) => setTimeout(r, 50))
        if (cancelled) return
        if (taskIdRef.current) return
        const res = await fetch("/api/goad/tasks", {
          credentials: "include",
          headers: impersonationHeaders(),
        })
        if (!res.ok || cancelled) return
        const data = await res.json() as { tasks: GoadTaskForCorrelation[] }
        const running = (data.tasks ?? []).find(
          (t) => t.instanceId === instanceId && t.status === "running"
        )
        if (!running || cancelled) return
        // Flag whether this task should switch to the Deploy tab so the
        // auto-tab effect can act on it when isRunning becomes true.
        resumedAsDeployRef.current = isDeployActionCommand(running.command)
        await resumeTask(running.id)
      } catch { /* best-effort */ }
    })()
    return () => { cancelled = true }
  }, [instanceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wizard post-deploy effect: after a wizard-initiated GOAD task finishes,
  // apply the network rules the user defined in the wizard (stored server-side
  // before the redirect because GOAD's install process overwrites range-config).
  useEffect(() => {
    if (exitCode === null || !instance?.ludusRangeId || !instance?.instanceId) return
    if (wizardNetworkHandledRef.current) return
    const rangeId = instance.ludusRangeId
    const id = instance.instanceId
    wizardNetworkHandledRef.current = true

    void (async () => {
      try {
        const res = await fetch(`/api/goad/instances/${encodeURIComponent(id)}/pending-network`)
        if (!res.ok) return
        const data = await res.json() as { snapshot: Record<string, unknown> | null }
        const snapshot = data.snapshot
        if (!snapshot) return

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
          for (let attempt = 0; attempt < 3; attempt++) {
            const dep = await ludusApi.deployRange(["network"], undefined, rangeId)
            if (!dep.error) break
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
  }, [exitCode, instance?.instanceId, instance?.ludusRangeId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    } catch {}
    setHistoryLoading(false)
  }, [instanceId, impersonationHeaders]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDeployHistory = useCallback(async () => {
    if (!instance?.ludusRangeId) return
    setDeployHistoryLoading(true)
    try {
      const result = await ludusApi.getRangeLogHistory(instance.ludusRangeId)
      setDeployHistory(extractArray<LogHistoryEntry>(result.data as unknown))
    } catch {}
    setDeployHistoryLoading(false)
  }, [instance?.ludusRangeId])

  const fetchAllHistory = useCallback(async () => {
    await Promise.all([fetchTaskHistory(), fetchDeployHistory()])
  }, [fetchTaskHistory, fetchDeployHistory])

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
        fetch(`/api/goad/tasks/${entry.goadTask.id}`).then(async (r) => {
          if (!r.ok) return
          const task = await r.json()
          const lines: string[] = task.lines ?? []
          setHistoryGoadLines(lines)
        }),
      )
    }

    await Promise.allSettled(promises)
    setHistoryDetailLoading(false)
  }, [instance?.ludusRangeId])

  const clearHistorySelection = useCallback(() => {
    setSelectedHistoryEntry(null)
    setHistoryDeployLines([])
    setHistoryGoadLines([])
  }, [])

  // Fetch instance data, catalog, and Ludus templates when instanceId / impersonation changes
  useEffect(() => {
    fetchInstances()
    fetch("/api/goad/catalog")
      .then((r) => r.json())
      .then((d: GoadCatalog) => { if (d.configured) setCatalog(d) })
      .catch(() => {})
    fetch("/api/proxy/templates")
      .then((r) => r.ok ? r.json() : [])
      .then((d) => {
        setTemplates(extractArray<TemplateObject>(d))
      })
      .catch(() => {})
  }, [fetchInstances]) // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * Run a GOAD command for this instance.
   * CLI-mode tasks (start/stop/destroy/status) use `-i <id> -t <task>`.
   * REPL-only commands (provide, provision_lab, install_extension) use stdin piping.
   * When an impersonation context is active the execute route will use root SSH + sudo.
   */
  // Always pass the instance's dedicated ludusRangeId so the server can inject
  // LUDUS_RANGE_ID and the ludus wrapper can add --range to every ludus CLI call
  // made inside GOAD.  Without this, GOAD targets the user's DEFAULT range.
  const runAction = async (action: string, goadArgs: string) => {
    setCurrentAction(action)
    clear()
    clearRangeLogs()
    const rangeIdForRestore = instance?.ludusRangeId
    let networkSnapshot: Record<string, unknown> | null = null
    if (RANGE_YAML_TOUCHING_ACTIONS.has(action) && rangeIdForRestore) {
      const cfg = await ludusApi.getRangeConfig(rangeIdForRestore)
      if (cfg.data?.result) {
        networkSnapshot = extractNetworkSection(cfg.data.result)
      }
      // Step 1 of the two-step firewall preservation: pre-inject the user's
      // current `network:` block into GOAD's workspace config.yml BEFORE the
      // GOAD action runs, so GOAD's `ludus range config set` call carries the
      // rules forward instead of wiping them. This closes the window where
      // the deploy would otherwise run against a network-less config and
      // flush iptables on the router. `provide` regenerates config.yml from
      // templates and will usually drop the injection — the post-action
      // restore + network-tag deploy below is the safety net for that case.
      if (networkSnapshot) {
        try {
          const resp = await fetch(
            `/api/goad/instances/${encodeURIComponent(instanceId)}/sync-network`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ network: networkSnapshot }),
            },
          )
          if (!resp.ok) {
            const body = (await resp.json().catch(() => ({}))) as { error?: string }
            console.warn(
              "[LUX] Pre-inject of network: into GOAD workspace config.yml failed:",
              body.error ?? `HTTP ${resp.status}`,
            )
          }
        } catch (err) {
          console.warn("[LUX] Pre-inject of network: threw:", (err as Error).message)
        }
      }
    }
    // Only switch to the Deploy Status tab (and start range streaming) for actions
    // that involve Ludus VM provisioning — where range logs are meaningful.
    // Other actions (start, stop, status, destroy) output to the terminal and
    // should leave the user on whatever tab they are currently viewing.
    if (DEPLOY_TAB_ACTIONS.has(action)) {
      setActiveTab("deploy")
      if (instance?.ludusRangeId) {
        // snapshotStart: true — for a fresh action we do NOT want to replay the
        // existing Ludus log buffer (which contains the previous deploy's output).
        // The panel shows "Waiting for output..." until GOAD triggers a new
        // range deploy, then streams only the new logs cleanly.
        startRangeStreaming(instance.ludusRangeId, { snapshotStart: true })
      }
    } else if (TERMINAL_TAB_ACTIONS.has(action)) {
      setActiveTab("terminal")
    }
    const rulesPresent = hasNetworkRules(networkSnapshot)

    const code = await run(goadArgs, instanceId, impersonation ?? undefined, instance?.ludusRangeId ?? undefined)
    setCurrentAction(null)
    // Capture task ID now — taskIdRef.current is kept in sync via render-time assignment
    const completedTaskId = taskIdRef.current
    try {
    // Always try to restore the user's `network:` block when we captured a
    // snapshot, regardless of exit code. Rationale: even a failed GOAD run can
    // have already rewritten range-config.yml from templates (goad-ludus.py
    // pushes the YAML before Ansible starts), so the firewall rules are
    // effectively gone unless we put them back. A no-op diff short-circuits
    // the PUT so this is cheap when GOAD actually left the file untouched.
    if (networkSnapshot && rangeIdForRestore) {
      const after = await ludusApi.getRangeConfig(rangeIdForRestore)
      const yamlAfter = after.data?.result
      if (yamlAfter != null) {
        // Semantic comparison: normalize both sides through the same yaml.dump so
        // Ludus's native YAML formatting vs js-yaml's output don't create false positives.
        const networkAlreadyCorrect = networkSectionEqual(yamlAfter, networkSnapshot)
        // Only compute merged (full-doc reformat) when we actually need to PUT.
        const merged = networkAlreadyCorrect ? yamlAfter : applyNetworkSection(yamlAfter, networkSnapshot)

        const startNetworkTagDeploy = async (): Promise<string | null> => {
          postProcessingRef.current = true
          if (completedTaskId) {
            await fetch(`/api/goad/tasks/${completedTaskId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phase: "network-deploy" }),
            }).catch(() => {})
          }
          setPostProcessingStep("network-deploying")

          // GOAD's Ansible run drives a Ludus range deploy internally. Even after
          // the GOAD SSH process exits, Ludus may still be in DEPLOYING/WAITING for
          // several more seconds (or minutes for large installs). Attempting to
          // start a second deploy while one is active fails immediately. Poll until
          // the range settles before firing the network-tag deploy.
          if (rangeIdForRestore) {
            const SETTLE_TIMEOUT_MS = 10 * 60 * 1000 // 10 min max wait
            const SETTLE_POLL_MS = 5_000
            const settleStart = Date.now()
            while (Date.now() - settleStart < SETTLE_TIMEOUT_MS) {
              const status = await ludusApi.getRangeStatus(rangeIdForRestore)
              const stateNow = status.data?.rangeState
              if (stateNow !== "DEPLOYING" && stateNow !== "WAITING") break
              await new Promise((r) => setTimeout(r, SETTLE_POLL_MS))
            }
          }

          let deployErr: string | null = null
          for (let attempt = 0; attempt < 3; attempt++) {
            const dep = await ludusApi.deployRange(["network"], undefined, rangeIdForRestore)
            if (!dep.error) {
              deployErr = null
              break
            }
            deployErr = typeof dep.error === "string" ? dep.error : "Unknown error"
            if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
          }
          return deployErr
        }

        if (!networkAlreadyCorrect) {
          // Network section was missing or different after GOAD — restore it.
          // Retry PUT — Ludus sometimes rejects range config writes momentarily
          // while it's finalising a deploy. 3 tries × 2s is short enough that
          // users don't notice the delay, but long enough to clear most locks.
          //
          // Before every attempt re-read range-config and re-merge against the
          // latest YAML. Background restore is racy: GOAD actions can finish
          // seconds or minutes after the user navigated away, during which the
          // user may have hand-edited range-config on /range/config (e.g.
          // removed extension entries). A plain "read once, PUT later" loop
          // happily trampled those edits with stale YAML. Re-reading each
          // attempt narrows the race to a single Ludus round-trip and, more
          // importantly, preserves any edits that completed between attempts.
          let putErr: string | null = null
          for (let attempt = 0; attempt < 3; attempt++) {
            let payload = merged
            if (attempt > 0) {
              const fresh = await ludusApi.getRangeConfig(rangeIdForRestore)
              const yamlNow = fresh.data?.result
              if (yamlNow != null) {
                const mergedNow = applyNetworkSection(yamlNow, networkSnapshot)
                if (mergedNow === yamlNow) {
                  // User already saved an equivalent network: block — nothing
                  // to restore, bail out rather than clobber their edits.
                  putErr = null
                  break
                }
                payload = mergedNow
              }
            }
            // Use force=true on retries — Ludus rejects normal config writes
            // while a deploy is still settling; force bypasses that lock.
            const put = await ludusApi.setRangeConfig(payload, rangeIdForRestore, attempt > 0)
            if (!put.error) {
              putErr = null
              queryClient.setQueryData(queryKeys.rangeConfig(scopeTag, rangeIdForRestore), payload)
              break
            }
            putErr = typeof put.error === "string" ? put.error : "Unknown error"
            if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
          }
          if (putErr) {
            toast({
              variant: "destructive",
              title: "Could not restore firewall settings",
              description:
                `${putErr}. Your previous rules are printed to the browser console (F12) — copy them into Range Configuration to recover.`,
            })
            try {
              console.warn(
                "[LUX] Failed to restore network: snapshot after GOAD action. Snapshot YAML follows.",
              )
              console.warn(JSON.stringify(networkSnapshot, null, 2))
            } catch { /* ignore */ }
          } else if (rulesPresent) {
            // Config is restored, but iptables on the router was already flushed
            // by GOAD's earlier deploy (which saw a config with no network: block).
            // A tag-scoped deploy re-runs only the router's firewall/network
            // Ansible tasks, which is fast (~30 s) and non-destructive. Without
            // this step the restored rules sit in range-config but aren't
            // actually enforced until the next full deploy.
            const deployErr = await startNetworkTagDeploy()
            if (deployErr) {
              toast({
                variant: "destructive",
                title: "Firewall config restored — redeploy required",
                description:
                  `Range config has your rules again, but auto-deploy of the "network" tag failed (${deployErr}). Iptables on the router is NOT yet updated. Run Range Configuration → Deploy (tag "network") to apply them.`,
              })
            } else if (code === 0) {
              toast({
                title: "Firewall rules preserved",
                description:
                  "Your network: block was re-applied and a fast network-tag deploy was kicked off so iptables picks up the rules. Watch Range Logs to confirm.",
              })
            } else {
              toast({
                title: "Firewall rules restored despite GOAD error",
                description:
                  `GOAD exited ${code}, but your network: block was re-applied and a network-tag deploy is running to re-apply iptables.`,
              })
            }
          }
        }
        // NOTE: if networkAlreadyCorrect the Ludus wrapper (goad-ssh.ts) already
        // intercepted GOAD's "ludus range config set" and re-injected the network
        // block before the config was pushed to Ludus. GOAD's own range deploy ran
        // with the correct config, so iptables are already enforced. No extra deploy.
      }
    }
    } finally {
      postProcessingRef.current = false
      if (completedTaskId) {
        await fetch(`/api/goad/tasks/${completedTaskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: null }),
        }).catch(() => {})
      }
      setPostProcessingStep("idle")
    }
    fetchInstances()
    return code
  }

  const handleStart = () =>
    confirm("Start all VMs?", () => runAction("start", `-i ${instanceId} -t start`))
  const handleStop = () =>
    confirm("Stop all VMs?", () => runAction("stop", `-i ${instanceId} -t stop`))

  /**
   * Unified Abort — stops the in-flight GOAD SSH/ansible task, aborts the
   * Ludus range deploy (user key → admin key), and falls back to writing
   * `rangeState=ABORTED` directly in PocketBase if Ludus's deploy goroutine
   * has already exited without updating state.
   *
   * The single button covers what used to be three (Stop Command, Stop
   * Deployment, Force Abort). Safe to call whether or not a range exists or a
   * GOAD task is running — the server simply skips whichever steps don't apply.
   */
  const handleAbort = useCallback(async () => {
    // Tear down the client-side streams immediately so the UI doesn't bounce
    // back into "Deploying…" while the server-side abort is in flight.
    try { await stop() } catch { /* stop() already swallows errors */ }
    stopRangeStreaming()

    const rangeId = instance?.ludusRangeId
    if (!rangeId) {
      // No dedicated range yet — killing the GOAD task via stop() is all we can do.
      return
    }

    const result = await abortRangeUnified({
      rangeId,
      goadInstanceId: instance?.instanceId ?? null,
      goadTaskId: taskId ?? null,
    })
    if (result.success) {
      clearRangeAborting(rangeId)
      await refreshRangeStateFromServer(rangeId)
      void fetchInstances()
    }
  }, [
    stop,
    stopRangeStreaming,
    abortRangeUnified,
    instance?.ludusRangeId,
    instance?.instanceId,
    taskId,
    refreshRangeStateFromServer,
    fetchInstances,
    clearRangeAborting,
  ])

  const requestAbort = () =>
    confirm(
      "Abort the running deployment? This stops any in-flight GOAD task and asks Ludus to reset range state (with PocketBase fallback if needed).",
      handleAbort,
    )
  /** Ensure this instance has a dedicated Ludus range before running any
   *  infrastructure command. Creates one via Ludus v2 multi-range API if
   *  not already set. Idempotent — no-ops if already initialised. */
  const ensureRangeIsolation = async (): Promise<string | null> => {
    if (instance?.ludusRangeId) return instance.ludusRangeId
    setInitializingRange(true)
    try {
      const res = await fetch(
        `/api/goad/instances/${encodeURIComponent(instanceId)}/init-range`,
        { method: "POST", headers: { "Content-Type": "application/json", ...impersonationHeaders() } }
      )
      const data = await res.json()
      if (!res.ok) {
        toast({ variant: "destructive", title: "Range creation failed", description: data.error || "Could not create a dedicated Ludus range for this instance." })
        return null
      }
      if (data.created) {
        toast({ title: "Dedicated range created", description: `Ludus range "${data.rangeId}" created for this instance.` })
      }
      fetchInstances() // refresh so ludusRangeId shows up
      return data.rangeId as string
    } catch (err) {
      toast({ variant: "destructive", title: "Range creation failed", description: (err as Error).message })
      return null
    } finally {
      setInitializingRange(false)
    }
  }

  // `provide` is a REPL command, not a -t task — use REPL mode so LUDUS_API_KEY is injected.
  // Ensure a dedicated range exists first so GOAD targets only this instance's range.
  const handleProvide = () =>
    confirm("Provide (create Ludus infrastructure)?", async () => {
      const rangeId = await ensureRangeIsolation()
      if (!rangeId) return
      await runAction("provide", `--repl "use ${instanceId};provide"`)
    })
  const handleProvisionLab = () =>
    confirm("Run full Ansible provisioning?", () =>
      runAction("provision-lab", `--repl "use ${instanceId};provision_lab"`)
    )

  /** One REPL session: Ludus infra (provide) then full lab Ansible (provision_lab) — same as wizard `goad -t install` split for Ludus. */
  const handleInstallProvideProvision = () =>
    confirm(
      [
        "Install — Provide + Provision lab?",
        "",
        "This runs two GOAD steps in one session:",
        "  1. Provide — create/update Ludus VMs and range infrastructure (no full lab Ansible yet).",
        "  2. Provision lab — run all Ansible playbooks for this lab (often 30–90 minutes).",
        "",
        "Use this for a full install when you would otherwise click Provide and then Provision Lab separately.",
      ].join("\n"),
      async () => {
        const rangeId = await ensureRangeIsolation()
        if (!rangeId) return
        await runAction(
          "install",
          `--repl "use ${instanceId};provide;provision_lab"`,
        )
      },
    )

  const handleStatus = () => runAction("status", `-i ${instanceId} -t status`)

  // ── Sync Range IPs ──────────────────────────────────────────────────────────
  // After a timed-out `provide`, the Ludus VMs are deployed but the workspace
  // inventory files still have the old placeholder IPs (192.168.56.X).
  // This calls the sync-ips endpoint which reads the real rangeNumber from Ludus
  // and rewrites instance.json + all inventory files without touching the VMs.
  const [syncingIps, setSyncingIps] = useState(false)
  const handleSyncIps = () =>
    confirm(
      "Sync Range IPs?\n\nThis reads the actual rangeNumber from Ludus and rewrites the inventory files with the correct 10.X.10.X IP addresses.\n\nSafe to run at any time — does not redeploy or modify any VMs.",
      async () => {
        setSyncingIps(true)
        try {
          const res = await fetch(
            `/api/goad/instances/${encodeURIComponent(instanceId)}/sync-ips`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ludusRangeId: instance?.ludusRangeId }),
            }
          )
          const data = await res.json()
          if (!res.ok || data.error) {
            toast({ variant: "destructive", title: "Sync failed", description: data.error ?? `HTTP ${res.status}` })
          } else if (data.success) {
            toast({
              title: "Range IPs synced",
              description: `Updated ${data.oldIpRange} → ${data.newIpRange} in ${data.updates.length} file(s)`,
            })
          } else {
            toast({
              variant: "destructive",
              title: "Sync completed with errors",
              description: data.errors?.join("; ") ?? "Check SSH configuration",
            })
          }
        } catch (err) {
          toast({ variant: "destructive", title: "Sync error", description: (err as Error).message })
        } finally {
          setSyncingIps(false)
        }
      }
    )

  const handleInstallExtension = (name: string) =>
    confirm(
      `Install "${name}"? Deploys new VMs and runs Ansible.`,
      () => runAction("install-extension", `--repl "use ${instanceId};install_extension ${name}"`),
      `ext-install:${name}`,
    )

  // provision_extension runs Ansible only (no infrastructure changes) — safe to re-run
  const handleReprovisionExtension = (ext: string) =>
    confirm(
      `Re-provision "${ext}"? This re-runs the Ansible playbook without changing infrastructure.`,
      async () => {
        setReprovisioningExtension(ext)
        await runAction("provision-extension", `--repl "use ${instanceId};provision_extension ${ext}"`)
        setReprovisioningExtension(null)
        toast({ title: "Re-provision finished", description: `Review terminal output for ${ext}.` })
      },
      `ext-reprovision:${ext}`,
    )

  const handleRemoveExtension = (ext: string) =>
    confirm(
      `Remove extension "${ext}"? Destroys matching Ludus VMs for this extension, then updates GOAD (instance.json + workspace inventory files). Cannot be undone.`,
      async () => {
        const rangeId = instance?.ludusRangeId
        if (!rangeId) {
          toast({
            variant: "destructive",
            title: "No Ludus range",
            description: "Run Provide first so this instance has a dedicated range.",
          })
          return
        }
        setRemovingExtension(ext)
        const errors: string[] = []
        try {
          const rangeRes = await ludusApi.getRangeStatus(rangeId)
          if (rangeRes.error) {
            errors.push(`Range status: ${rangeRes.error}`)
          } else {
            const vms = rangeRes.data?.VMs ?? rangeRes.data?.vms ?? []
            const def = catalog?.extensions?.find((e) => e.name === ext)
            const machines = def?.machines ?? []
            const proxIds = matchingVmIdsForExtension(ext, machines, vms)
            if (proxIds.length === 0) {
              errors.push(
                "No Ludus VMs matched this extension (catalog hostnames + name heuristics). GOAD metadata will still be updated.",
              )
            }
            for (const pid of proxIds) {
              const vm = vms.find((v) => (v.proxmoxID ?? v.ID) === pid)
              const vmLabel = vm?.name || String(pid)
              const r = await ludusApi.destroyVm(pid, rangeId)
              if (r.error) {
                errors.push(`VMID ${pid}: ${r.error}`)
                void postVmOperationAudit({
                  kind: "destroy_vm",
                  rangeId,
                  instanceId,
                  vmId: pid,
                  vmName: vmLabel,
                  extensionName: ext,
                  status: "error",
                  detail: r.error,
                })
              } else {
                void postVmOperationAudit({
                  kind: "destroy_vm",
                  rangeId,
                  instanceId,
                  vmId: pid,
                  vmName: vmLabel,
                  extensionName: ext,
                  status: "ok",
                  detail: r.data?.result ?? undefined,
                })
                const ip = vm && typeof vm.ip === "string" ? vm.ip.trim() : ""
                if (ip) void pruneKnownHosts([ip])
              }
            }
          }

          // Also strip the extension's VMs from Ludus range-config.yml. Without
          // this, range-config keeps stale `ludus:` entries — a later full
          // deploy (or a manual Save from /range/config) re-materialises the
          // VMs, and the user sees the extension "come back" even though it
          // was removed from GOAD. destroyVm only removes the running VM from
          // Proxmox/PocketBase; it does not touch range-config.yml.
          const cfgBefore = await ludusApi.getRangeConfig(rangeId)
          let rangeConfigRemoved: string[] = []
          if (cfgBefore.error) {
            errors.push(`Range config fetch: ${cfgBefore.error}`)
          } else {
            const yamlBefore = cfgBefore.data?.result ?? ""
            const { yaml: yamlAfter, removed } = removeExtensionVmsFromRangeConfig(
              yamlBefore,
              ext,
            )
            rangeConfigRemoved = removed
            if (yamlAfter !== yamlBefore) {
              let putErr: string | null = null
              for (let attempt = 0; attempt < 3; attempt++) {
                const put = await ludusApi.setRangeConfig(yamlAfter, rangeId, attempt > 0)
                if (!put.error) {
                  putErr = null
                  break
                }
                putErr = typeof put.error === "string" ? put.error : "Unknown error"
                if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
              }
              if (putErr) {
                errors.push(`Range config cleanup: ${putErr}`)
              } else {
                queryClient.setQueryData(queryKeys.rangeConfig(scopeTag, rangeId), yamlAfter)
              }
            }
          }

          const rmRes = await fetch(
            `/api/goad/instances/${encodeURIComponent(instanceId)}/remove-extension`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ extensionName: ext }),
            },
          )
          const rmData = (await rmRes.json().catch(() => ({}))) as {
            error?: string
            errors?: string[]
            removedFromInstance?: boolean
            deletedFiles?: string[]
            updatedConfigs?: { file: string; entries: string[] }[]
          }
          if (!rmRes.ok || rmData.error) {
            errors.push(rmData.error ?? `remove-extension HTTP ${rmRes.status}`)
          } else if (Array.isArray(rmData.errors) && rmData.errors.length > 0) {
            errors.push(...rmData.errors)
          }

          // Summarise what was cleaned up on the GOAD side so the audit row
          // makes it obvious whether provider config.yml was actually pruned
          // (missing => a subsequent Provide will re-deploy the VM).
          const cleanupParts: string[] = []
          if (rmData.removedFromInstance) cleanupParts.push("instance.json")
          if ((rmData.deletedFiles?.length ?? 0) > 0) {
            cleanupParts.push(`${rmData.deletedFiles!.length} inventory file(s)`)
          }
          // GOAD config entries contain Ansible/Jinja2 template strings like
          // "{{ range_id }}-GOAD-ext". Resolve the common variable so the audit
          // log shows actual values instead of raw template syntax.
          const resolveGoadTemplates = (s: string) =>
            s.replace(/\{\{\s*range_id\s*\}\}/g, rangeId)
          const cfgEntries = (rmData.updatedConfigs ?? [])
            .flatMap((c) => c.entries)
            .map(resolveGoadTemplates)
          if (cfgEntries.length > 0) {
            cleanupParts.push(`config.yml -${cfgEntries.join(",")}`)
          }
          if (rangeConfigRemoved.length > 0) {
            cleanupParts.push(`range-config.yml -${rangeConfigRemoved.map(resolveGoadTemplates).join(",")}`)
          }

          void postVmOperationAudit({
            kind: "remove_extension",
            rangeId,
            instanceId,
            extensionName: ext,
            status: errors.length === 0 ? "ok" : "error",
            detail:
              errors.length === 0
                ? cleanupParts.length > 0
                  ? `GOAD cleanup: ${cleanupParts.join(", ")}`
                  : "GOAD cleanup: nothing to remove"
                : errors.slice(0, 8).join(" · "),
          })

          await fetchInstances()

          if (errors.length > 0) {
            toast({
              variant: "destructive",
              title: "Remove extension completed with issues",
              description: errors.slice(0, 5).join(" · "),
            })
          } else {
            toast({ title: "Extension removed", description: ext })
          }
        } catch (err) {
          toast({
            variant: "destructive",
            title: "Remove extension failed",
            description: (err as Error).message,
          })
        } finally {
          setRemovingExtension(null)
        }
      },
      `ext-remove:${ext}`,
    )

  const handleDestroy = () => {
    const rangeInfo = instance?.ludusRangeId
      ? `This will delete dedicated Ludus range "${instance.ludusRangeId}" and all its VMs.`
      : "All VMs provisioned by this instance will be destroyed. Run Provide first to isolate this instance to its own range."
    confirm(
      `Permanently destroy "${instanceId}"? ${rangeInfo} This cannot be undone.`,
      async () => {
        await runAction("destroy", `-i ${instanceId} -t destroy`)
        // Clean up workspace after GOAD destroy
        try {
          await fetch(`/api/goad/instances/${encodeURIComponent(instanceId)}/force-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...impersonationHeaders() },
            body: JSON.stringify({ ludusRangeId: instance?.ludusRangeId }),
          })
        } catch {}
        // Refresh the range list so the deleted range is dropped from context
        // and the UI automatically switches to the next available range.
        await refreshRanges()
        toast({ title: "Lab destroyed" })
        router.push("/goad")
      }
    )
  }

  const handleForceDelete = () =>
    confirm(
      `FORCE DELETE "${instanceId}"? This bypasses GOAD and directly destroys the Ludus range + workspace. Use only when normal destroy fails.`,
      async () => {
        try {
          const res = await fetch(`/api/goad/instances/${encodeURIComponent(instanceId)}/force-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...impersonationHeaders() },
            body: JSON.stringify({ ludusRangeId: instance?.ludusRangeId }),
          })
          const result = await res.json()
          // Refresh range list so the deleted range is dropped and UI auto-switches
          await refreshRanges()
          if (result.errors?.length) {
            toast({ title: "Force delete partially succeeded", description: result.errors.join("; "), variant: "destructive" })
          } else {
            toast({ title: "Instance force-deleted" })
          }
          router.push("/goad")
        } catch (err) {
          toast({ title: "Force delete failed", description: (err as Error).message, variant: "destructive" })
        }
      }
    )

  const labInfo: GoadLabDef | undefined = catalog?.labs.find((l) => l.name === instance?.lab)
  const extMap: Record<string, GoadExtensionDef> = Object.fromEntries(
    (catalog?.extensions ?? []).map((e) => [e.name, e])
  )
  const uninstalledExtensions: GoadExtensionDef[] = (catalog?.extensions ?? []).filter((ext) => {
    if (instance?.extensions?.includes(ext.name)) return false
    if (!instance?.lab) return true
    return ext.compatibility.includes("*") || ext.compatibility.includes(instance.lab)
  })

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "READY": return <Badge variant="success">Ready</Badge>
      case "PROVIDED": return <Badge variant="info">Provided</Badge>
      case "CREATED": return <Badge variant="warning">Created</Badge>
      default: return <Badge variant="secondary">{status}</Badge>
    }
  }

  const getTaskStatusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge variant="success" className="text-xs">Completed</Badge>
      case "running": return <Badge variant="warning" className="text-xs animate-pulse">Running</Badge>
      case "error": return <Badge variant="destructive" className="text-xs">Error</Badge>
      case "aborted": return <Badge variant="secondary" className="text-xs">Aborted</Badge>
      default: return <Badge variant="secondary" className="text-xs">{status}</Badge>
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] gap-6 min-h-0">
      {/* ── Re-assign dialog ─────────────────────────────────────────────── */}
      {showReassign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl border-blue-500/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <UserCog className="h-4 w-4 text-blue-400" />
                  Re-assign Instance
                </CardTitle>
                <Button size="icon-sm" variant="ghost" onClick={() => setShowReassign(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription className="text-xs">
                  This will change the OS-level file owner of the GOAD workspace on the server
                  and reassign the associated Ludus range to the target user.
                </AlertDescription>
              </Alert>
              <div className="space-y-1.5">
                <Label className="text-xs">Target User</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  value={reassignTargetUser}
                  onChange={(e) => setReassignTargetUser(e.target.value)}
                >
                  <option value="">— select user —</option>
                  {reassignUsers.map((u) => (
                    <option key={u.userID} value={u.userID}>{u.userID}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ludus Range ID (optional — leave blank to keep current)</Label>
                <Input
                  className="font-mono text-xs"
                  placeholder={instance?.ludusRangeId ?? "e.g. johndoe-GOAD-Mini-ABC123"}
                  value={reassignTargetRange}
                  onChange={(e) => setReassignTargetRange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Current: <code className="text-primary">{instance?.ludusRangeId ?? "none"}</code>
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowReassign(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleReassign}
                  disabled={!reassignTargetUser || reassigning}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {reassigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCog className="h-3.5 w-3.5" />}
                  Re-assign
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href="/goad"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-mono font-bold">{instance.instanceId}</h1>
            <Badge variant="secondary">{instance.lab}</Badge>
            {getStatusBadge(instance.status)}
            {instance.isDefault && <Badge variant="cyan">Default</Badge>}
          </div>
          <div className="flex gap-4 mt-1 flex-wrap">
            {instance.ownerUserId && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" /> {instance.ownerUserId}
              </span>
            )}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Wifi className="h-3 w-3" /> {instance.ipRange || "IP not yet assigned"}
            </span>
            {instance.ludusRangeId ? (
              <span className="text-xs text-green-400 flex items-center gap-1" title="This instance has its own dedicated Ludus range — destroying it will not affect other ranges">
                <Server className="h-3 w-3" />
                range: <code className="ml-0.5">{instance.ludusRangeId}</code>
              </span>
            ) : (
              <span className="text-xs text-yellow-400 flex items-center gap-1" title="No dedicated range yet — click Provide to create an isolated range for this instance">
                <Server className="h-3 w-3" />
                {instance.provider} / {instance.provisioner} (no dedicated range)
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={fetchInstances} disabled={loading || refreshing}>
          <RefreshCw className={cn("h-4 w-4", (loading || refreshing) && "animate-spin")} />
        </Button>
      </div>

      {/* Actions */}
      <Card className="flex-shrink-0">
        <CardContent className="p-3 space-y-2">
          {/* Global / unscoped confirmations (Provide, Provision lab, Destroy, …).
              Per-row extension confirmations render inline in each row instead of here. */}
          <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />

          {/* ── Action buttons ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="default"
                className="bg-emerald-700 hover:bg-emerald-600 text-white"
                onClick={handleInstallProvideProvision}
                disabled={isRunning || initializingRange || !!pendingAction}
                title="Provide then Provision lab in one GOAD session (full install)"
              >
                {(isRunning && currentAction === "install") || initializingRange ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <HardDriveDownload className="h-3.5 w-3.5" />
                )}
                {initializingRange ? "Creating range..." : "Install"}
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={handleProvide} disabled={isRunning || initializingRange || !!pendingAction}
                title="Deploy/update Ludus infrastructure (no Ansible). Creates a dedicated range if needed."
              >
                {(isRunning && currentAction === "provide") || initializingRange
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Server className="h-3.5 w-3.5" />}
                {initializingRange ? "Creating range..." : "Provide"}
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={handleProvisionLab} disabled={isRunning || !!pendingAction}
                title="Run all Ansible playbooks to configure the lab"
              >
                {isRunning && currentAction === "provision-lab"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Wrench className="h-3.5 w-3.5" />}
                Provision Lab
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={handleSyncIps} disabled={isRunning || syncingIps || !!pendingAction || !instance?.ludusRangeId}
                title={
                  !instance?.ludusRangeId
                    ? "No dedicated range yet — run Provide first"
                    : "Sync inventory files with the actual Ludus range IPs (use after a timed-out provide)"
                }
              >
                {syncingIps
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <MapPin className="h-3.5 w-3.5" />}
                Sync IPs
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={handleStart} disabled={isRunning || !!pendingAction}
                title="Power on all VMs"
              >
                {isRunning && currentAction === "start"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Power className="h-3.5 w-3.5" />}
                Start All
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={handleStop} disabled={isRunning || !!pendingAction}
                title="Power off all VMs"
              >
                {isRunning && currentAction === "stop"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <PowerOff className="h-3.5 w-3.5" />}
                Stop All
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={handleStatus} disabled={isRunning || !!pendingAction}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Status
              </Button>
            </div>

            {(isRunning ||
              rangeState === "DEPLOYING" ||
              rangeState === "WAITING" ||
              isAborting) && (
              <Button
                size="sm"
                variant="destructive"
                onClick={requestAbort}
                disabled={isAborting}
              >
                {isAborting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <StopCircle className="h-3.5 w-3.5" />
                )}
                {isAborting ? "Aborting…" : "Abort"}
              </Button>
            )}

            <div className="flex-1" />

            {isAdmin && (
              <Button
                size="sm" variant="outline"
                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                onClick={openReassignDialog} disabled={isRunning || !!pendingAction}
                title="Re-assign this GOAD instance (and its range) to a different user"
              >
                <UserCog className="h-3.5 w-3.5" />
                Re-assign
              </Button>
            )}
            <Button
              size="sm" variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={handleDestroy} disabled={isRunning || !!pendingAction}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Instance + Range
            </Button>
            <Button
              size="sm" variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={handleForceDelete} disabled={isRunning || !!pendingAction}
              title="Force-delete: bypass GOAD and directly remove the Ludus range + workspace"
            >
              <X className="h-3.5 w-3.5" />
              Force Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs — flex-1 so terminal tab can fill remaining height */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList>
          <TabsTrigger value="deploy">
            <Activity className="h-3.5 w-3.5 mr-1.5" />
            Deploy Status
            {(isRunning || isRangeStreaming) && (
              <span className="ml-1.5 h-2 w-2 rounded-full bg-green-400 animate-pulse inline-block" />
            )}
          </TabsTrigger>
          <TabsTrigger value="terminal">
            <Terminal className="h-3.5 w-3.5 mr-1.5" />
            Terminal
          </TabsTrigger>
          <TabsTrigger value="info">
            <Server className="h-3.5 w-3.5 mr-1.5" />
            Lab Info
          </TabsTrigger>
          <TabsTrigger value="inventories" onClick={() => inventories.length === 0 && !inventoriesLoading && fetchInventories()}>
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Inventories
            {inventories.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">({inventories.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="extensions">
            <Puzzle className="h-3.5 w-3.5 mr-1.5" />
            Extensions ({instance.extensions.length})
          </TabsTrigger>
          <TabsTrigger value="history" onClick={fetchAllHistory}>
            <History className="h-3.5 w-3.5 mr-1.5" />
            Logs History
          </TabsTrigger>
        </TabsList>

        {/* Deploy Status — side-by-side Range Logs + GOAD terminal */}
        <TabsContent value="deploy" className="mt-4 flex flex-col min-h-0 flex-1">
          {/* Status bar */}
          <div className="flex items-center gap-3 mb-3 flex-shrink-0 flex-wrap">
            {isRunning && currentAction && (
              <>
                <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-sm text-green-400">Running: {currentAction}</span>
              </>
            )}
            {instance.ludusRangeId && rangeState && (
              <Badge
                variant={
                  rangeState === "SUCCESS" ? "success"
                  : rangeState === "ERROR" || rangeState === "ABORTED" ? "destructive"
                  : "warning"
                }
              >
                <Server className="h-3 w-3 mr-1" />
                Range: {rangeState}
              </Badge>
            )}
            {!instance.ludusRangeId && (
              <span className="text-xs text-yellow-400">
                No dedicated range — click Provide to create one before provisioning.
              </span>
            )}
            {exitCode !== null && (
              <Badge variant={exitCode === 0 ? "success" : "destructive"}>
                GOAD {exitCode === 0 ? "Completed ✓" : `Failed (exit ${exitCode})`}
              </Badge>
            )}
            {(lines.length === 0 && rangeLogLines.length === 0 && !isRunning) && (
              <span className="text-xs text-muted-foreground">
                Use an action button above to start — output will appear here.
              </span>
            )}
          </div>

          {/* Deploy pipeline — shown while GOAD is running with network rules or
               while the post-GOAD network-tag deploy is in progress. */}
          {postProcessingStep !== "idle" && (
            <div className="mb-3 flex-shrink-0 flex items-center gap-2 rounded-lg border border-blue-500/25 bg-blue-500/[0.05] px-3 py-2 text-xs">
              <Shield className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded border text-[11px]",
                  postProcessingStep === "network-deploying"
                    ? "border-green-500/30 bg-green-500/10 text-green-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-400",
                )}>
                  {postProcessingStep === "network-deploying"
                    ? <Check className="h-2.5 w-2.5" />
                    : <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  }
                  Step 1 — GOAD {postProcessingStep === "network-deploying" ? "done" : "running"}
                </span>
                <span className="text-muted-foreground/60">→</span>
                <span className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded border text-[11px]",
                  postProcessingStep === "network-deploying"
                    ? "border-blue-500/40 bg-blue-500/10 text-blue-300 animate-pulse"
                    : "border-border/60 bg-muted/30 text-muted-foreground",
                )}>
                  {postProcessingStep === "network-deploying"
                    ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    : <Shield className="h-2.5 w-2.5" />
                  }
                  Step 2 — Firewall redeploy {postProcessingStep === "network-deploying" ? "running" : "pending"}
                </span>
              </div>
            </div>
          )}

          {/* Stuck-DEPLOYING warning — shown when the stream has closed but the
               range is still in DEPLOYING (Ludus goroutine exited without updating
               PocketBase). The Abort button in the status bar above resolves this
               automatically via the unified abort route (Ludus user → admin →
               PocketBase fallback), so this panel just explains what happened. */}
          {!isRangeStreaming && !isRunning && (rangeState === "DEPLOYING" || rangeState === "WAITING") && instance.ludusRangeId && (
            <Alert variant="destructive" className="mb-3 flex-shrink-0">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Range stuck in DEPLOYING.</strong> The Ludus deployment process appears to have
                finished without updating its state — a known Ludus issue after certain Ansible
                failures. Use the red <strong>Abort</strong> button in the top action bar (next to Status)
                to reset the range state so you can re-run Provide.
              </AlertDescription>
            </Alert>
          )}

          {/* Side-by-side panels */}
          <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
            <GoadTerminal
              lines={rangeLogLines}
              onClear={clearRangeLogs}
              onRefresh={instance.ludusRangeId ? handleRefreshRangeLogs : undefined}
              refreshLoading={rangeLogRefreshBusy}
              label={`Range Logs — ${instance.ludusRangeId ?? "no range"}${isRangeStreaming ? ` (live)${rangeElapsed ? ` · ${rangeElapsed}` : ""}` : rangeState ? ` · ${rangeState}` : ""}`}
              className="flex flex-col min-h-0 h-full"
            />
            <GoadTerminal
              lines={lines}
              onClear={clear}
              label={`GOAD Logs — ${instanceId}${isRunning ? ` — ${currentAction ?? "running"}${goadElapsed ? ` · ${goadElapsed}` : ""}` : exitCode !== null ? ` · exit ${exitCode}` : ""}`}
              className="flex flex-col min-h-0 h-full"
            />
          </div>
        </TabsContent>

        {/* Terminal (GOAD output only — kept for backward compat / manual inspection) */}
        <TabsContent value="terminal" className="mt-4 flex flex-col min-h-0 flex-1">
          {lines.length === 0 && !isRunning && (
            <p className="text-xs text-muted-foreground mb-3 flex-shrink-0">
              Use the action buttons above to run GOAD commands. Output will appear here and persist if you navigate away.
            </p>
          )}
          <GoadTerminal
            lines={lines}
            onClear={clear}
            className="flex-1 flex flex-col min-h-0 w-full"
            label={`${instanceId} — ${currentAction ?? taskId ?? "terminal"}`}
          />
          {exitCode !== null && (
            <Alert
              variant={exitCode === 0 ? "success" : "destructive"}
              className="mt-3 flex-shrink-0"
            >
              <AlertDescription>
                Command exited with code {exitCode}{exitCode === 0 ? " ✓" : " ✗"}
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* Lab Info */}
        <TabsContent value="info" className="mt-4">
          <div className="space-y-4">
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">GOAD compiled inventories</p>
                    <p className="text-xs text-muted-foreground">
                      Base inventory and extension inventories for this instance (workspace/{instanceId})
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setActiveTab("inventories")
                    if (inventories.length === 0 && !inventoriesLoading) fetchInventories()
                  }}
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  View inventories
                </Button>
              </CardContent>
            </Card>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Lab Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  ["Lab", instance.lab],
                  ["Instance ID", instance.instanceId],
                  ["Status", instance.status],
                  ["IP Range", instance.ipRange || "Not assigned"],
                  ["Provider", instance.provider],
                  ["Provisioner", instance.provisioner],
                ].map(([key, val]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-muted-foreground text-xs">{key}</span>
                    <code className="font-mono text-xs">{val}</code>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Lab Description</CardTitle>
              </CardHeader>
              <CardContent>
                {labInfo ? (
                  <div className="space-y-2">
                    {labInfo.description && (
                      <p className="text-xs text-muted-foreground">{labInfo.description}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="text-center p-2 bg-muted/50 rounded-md">
                        <p className="text-lg font-bold">{labInfo.vmCount}</p>
                        <p className="text-xs text-muted-foreground">VMs</p>
                      </div>
                      <div className="text-center p-2 bg-muted/50 rounded-md">
                        <p className="text-lg font-bold">{labInfo.domains}</p>
                        <p className="text-xs text-muted-foreground">Domains</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No description available</p>
                )}
              </CardContent>
            </Card>
          </div>
          </div>
        </TabsContent>

        {/* Compiled inventories (base + extension inventories from workspace) */}
        <TabsContent value="inventories" className="mt-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Inventory files in <code className="text-primary">workspace/{instanceId}</code> (base + each extension).
              </p>
              <Button size="sm" variant="ghost" onClick={fetchInventories} disabled={inventoriesLoading}>
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", inventoriesLoading && "animate-spin")} />
                {inventoriesLoading ? "Loading..." : "Refresh"}
              </Button>
            </div>
            {inventoriesError && (
              <Alert variant="destructive">
                <AlertDescription>{inventoriesError}</AlertDescription>
              </Alert>
            )}
            {inventoriesLoading && inventories.length === 0 ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : inventories.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No inventory files found. Run Provide to create the workspace.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1 space-y-1">
                  {inventories.map((inv) => (
                    <Button
                      key={inv.name}
                      variant={selectedInventoryName === inv.name ? "secondary" : "ghost"}
                      size="sm"
                      className="w-full justify-start font-mono text-xs"
                      onClick={() => setSelectedInventoryName(inv.name)}
                    >
                      <FileText className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
                      {inv.name}
                    </Button>
                  ))}
                </div>
                <div className="md:col-span-2">
                  {selectedInventoryName && (() => {
                    const inv = inventories.find((i) => i.name === selectedInventoryName)
                    if (!inv) return null
                    return (
                      <Card>
                        <CardHeader className="pb-2 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-mono">{inv.name}</CardTitle>
                          <div className="flex gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Copy"
                              onClick={() => copyInventoryToClipboard(inv.content, inv.name)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Download"
                              onClick={() => downloadInventory(inv.content, inv.name)}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0">
                          <pre className="p-3 text-xs font-mono overflow-auto max-h-[60vh] bg-muted/30 rounded-b-lg whitespace-pre-wrap break-all">
                            {inv.content || "(empty)"}
                          </pre>
                        </CardContent>
                      </Card>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Extensions */}
        <TabsContent value="extensions" className="mt-4">
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="text-xs">
                <strong>Install</strong> runs providing + Ansible for a new extension.{" "}
                <strong>Re-provision</strong> re-runs only the Ansible playbook for an already-installed
                extension — use this to re-apply config or fix a failed provisioning without touching
                infrastructure. <strong>Remove</strong> destroys extension VMs in Ludus and drops the extension from
                GOAD workspace metadata. Both require <code className="text-primary">Provide</code> to have run first.
              </AlertDescription>
            </Alert>
            {instance.extensions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Installed</p>
                <div className="grid gap-2">
                  {instance.extensions.map((ext) => {
                    const scopeReprov = `ext-reprovision:${ext}`
                    const scopeRemove = `ext-remove:${ext}`
                    const rowHasPending =
                      pendingAction?.key === scopeReprov || pendingAction?.key === scopeRemove
                    return (
                      <div
                        key={ext}
                        className="rounded-lg border border-green-500/30 bg-green-500/5"
                      >
                        <div className="flex items-center justify-between p-3">
                          <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
                            <div>
                              <code className="font-mono text-sm text-green-400">{ext}</code>
                              {extMap[ext]?.description && (
                                <p className="text-xs text-muted-foreground">{extMap[ext].description}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => handleReprovisionExtension(ext)}
                              disabled={
                                isRunning ||
                                // Allow click only when no other confirmation is open; a prompt
                                // for THIS row stays clickable so the user can re-trigger if needed.
                                (!!pendingAction && !rowHasPending) ||
                                instance.status === "CREATED" ||
                                removingExtension === ext
                              }
                              title="Re-run Ansible provisioning for this extension (no infrastructure changes)"
                            >
                              {reprovisioningExtension === ext ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              {reprovisioningExtension === ext ? "Running..." : "Re-provision"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive border-destructive/40 hover:bg-destructive/10"
                              onClick={() => handleRemoveExtension(ext)}
                              disabled={
                                isRunning ||
                                (!!pendingAction && !rowHasPending) ||
                                instance.status === "CREATED" ||
                                !instance.ludusRangeId ||
                                reprovisioningExtension === ext ||
                                removingExtension === ext
                              }
                              title={
                                !instance.ludusRangeId
                                  ? "Run Provide first — a dedicated Ludus range is required"
                                  : "Destroy extension VMs in Ludus and remove from GOAD instance"
                              }
                            >
                              {removingExtension === ext ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                              {removingExtension === ext ? "Removing..." : "Remove"}
                            </Button>
                          </div>
                        </div>
                        {/* Inline confirmation for this specific row — replaces the
                            old page-top bar so the user doesn't lose their place. */}
                        <ConfirmBar
                          pending={pendingAction}
                          scope={scopeReprov}
                          onConfirm={commitConfirm}
                          onCancel={cancelConfirm}
                          className="mx-3 mb-3"
                        />
                        <ConfirmBar
                          pending={pendingAction}
                          scope={scopeRemove}
                          onConfirm={commitConfirm}
                          onCancel={cancelConfirm}
                          className="mx-3 mb-3"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {uninstalledExtensions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Available to Install</p>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Install adds new VMs and runs Ansible (30–90 min). Re-provision re-runs Ansible only. Remove destroys extension VMs.
                </p>
                <div className="grid gap-2">
                  {uninstalledExtensions.map((ext) => {
                    const tpl = checkTemplates(ext.requiredTemplates ?? [], builtNames, allNames)
                    const templatesReady = tpl.ready || (ext.requiredTemplates ?? []).length === 0
                    const canInstall =
                      templatesReady &&
                      !!instance.ludusRangeId &&
                      instance.status !== "CREATED" &&
                      !isRunning
                    const scopeInstall = `ext-install:${ext.name}`
                    return (
                      <div
                        key={ext.name}
                        className={cn(
                          "rounded-lg border",
                          !templatesReady
                            ? "border-border opacity-70"
                            : "border-border hover:border-primary/30",
                        )}
                      >
                        <div className="flex items-start justify-between p-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <Package className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <code className="font-mono text-sm">{ext.name}</code>
                                {ext.machines.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    +{ext.machines.length} VM{ext.machines.length !== 1 ? "s" : ""}
                                  </span>
                                )}
                                {!templatesReady && (
                                  <Badge variant="destructive" className="text-xs gap-1">
                                    <PackageX className="h-2.5 w-2.5" /> Missing templates
                                  </Badge>
                                )}
                              </div>
                              {ext.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">{ext.description}</p>
                              )}
                              {(ext.requiredTemplates ?? []).length > 0 && (
                                <TemplateChips required={ext.requiredTemplates} builtNames={builtNames} allNames={allNames} />
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-shrink-0 ml-3 gap-1.5"
                            onClick={() => handleInstallExtension(ext.name)}
                            disabled={!canInstall}
                            title={
                              instance.status === "CREATED"
                                ? "Run Provide before installing extensions"
                                : !instance.ludusRangeId
                                ? "Run Provide first — a dedicated Ludus range is required"
                                : !templatesReady
                                ? `Missing Ludus templates: ${[...tpl.missingAbsent, ...tpl.missingUnbuilt].join(", ")}`
                                : isRunning
                                ? "Wait for current action to finish"
                                : "Install this extension"
                            }
                          >
                            <Play className="h-3.5 w-3.5" />
                            Install
                          </Button>
                        </div>
                        <ConfirmBar
                          pending={pendingAction}
                          scope={scopeInstall}
                          onConfirm={commitConfirm}
                          onCancel={cancelConfirm}
                          className="mx-3 mb-3"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {instance.extensions.length === 0 && uninstalledExtensions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No extensions available for this lab
              </p>
            )}
          </div>
        </TabsContent>

        {/* Logs History — correlated Ludus deploy + GOAD CLI side-by-side */}
        <TabsContent value="history" className="mt-4 flex flex-col min-h-0 flex-1">
          {selectedHistoryEntry ? (
            /* ── Detail view: side-by-side logs ── */
            <div className="flex flex-col min-h-0 flex-1">
              <div className="flex items-center gap-3 mb-3 flex-shrink-0">
                <Button size="sm" variant="ghost" onClick={clearHistorySelection} className="gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
              </div>
              {historyDetailLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {(selectedHistoryEntry.deployEntry || selectedHistoryEntry.goadTask) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 flex-shrink-0">
                      {selectedHistoryEntry.deployEntry &&
                        (() => {
                          const batch = selectedHistoryEntry.mergedBatchDeploys
                          const de = selectedHistoryEntry.deployEntry
                          const ludusStatus =
                            batch && batch.length > 0 ? aggregateDeployStatuses(batch) : de.status
                          const sorted =
                            batch && batch.length > 0
                              ? [...batch].sort(
                                  (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
                                )
                              : null
                          const winStart = sorted?.[0]?.start ?? de.start
                          const winEnd = sorted?.length
                            ? sorted.reduce((a, b) =>
                                new Date(a.end).getTime() >= new Date(b.end).getTime() ? a : b,
                              ).end
                            : de.end
                          const st = ludusStatus.toLowerCase()
                          const badgeVariant =
                            st === "success" ? "success" : st === "running" || st === "waiting" ? "warning" : "destructive"
                          return (
                        <Card className="border-border/80">
                          <CardHeader className="p-3 pb-2 space-y-0">
                            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 min-w-0 flex-wrap">
                                <Server className="h-3.5 w-3.5 shrink-0" />
                                <span>
                                  {batch && batch.length > 1 ? `Ludus deploys (${batch.length})` : "Ludus deploy"}
                                </span>
                                <Badge variant={badgeVariant} className="text-[10px] capitalize">
                                  {ludusStatus}
                                </Badge>
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-7 w-7 shrink-0"
                                title="Copy first deploy log id"
                                onClick={() => {
                                  void navigator.clipboard.writeText(de.id)
                                  toast({ title: "Copied", description: "Deploy log id copied" })
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 pt-0 text-xs space-y-1.5 text-muted-foreground">
                            {batch && batch.length > 1 ? (
                              <div className="space-y-1">
                                {batch.map((d) => (
                                  <p key={d.id} className="font-mono break-all">
                                    <span className="text-muted-foreground/80">Id </span>
                                    <span className="text-foreground">{d.id}</span>
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="font-mono break-all">
                                <span className="text-muted-foreground/80">Id </span>
                                <span className="text-foreground">{de.id}</span>
                              </p>
                            )}
                            <p>
                              <span className="text-muted-foreground/80">Window </span>
                              {formatLogHistoryLocalRange(winStart, winEnd)}
                              <span className="text-border mx-1">·</span>
                              {formatLogHistoryDuration(winStart, winEnd)}
                            </p>
                            {de.template?.trim() && (
                              <code
                                className="block text-[11px] text-primary/90 truncate"
                                title={de.template}
                              >
                                {de.template}
                              </code>
                            )}
                          </CardContent>
                        </Card>
                          )
                        })()}
                      {selectedHistoryEntry.goadTask && (
                        <Card className="border-border/80">
                          <CardHeader className="p-3 pb-2 space-y-0">
                            <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 min-w-0 flex-wrap">
                                <Puzzle className="h-3.5 w-3.5 shrink-0" />
                                <span>GOAD task</span>
                                {getTaskStatusBadge(selectedHistoryEntry.goadTask.status)}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-7 w-7 shrink-0"
                                title="Copy task id"
                                onClick={() => {
                                  void navigator.clipboard.writeText(selectedHistoryEntry.goadTask!.id)
                                  toast({ title: "Copied", description: "Task id copied" })
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 pt-0 text-xs space-y-1.5 text-muted-foreground">
                            <p className="font-mono break-all">
                              <span className="text-muted-foreground/80">Id </span>
                              <span className="text-foreground">{selectedHistoryEntry.goadTask.id}</span>
                            </p>
                            <p>
                              {formatTaskInstant(selectedHistoryEntry.goadTask.startedAt)}
                              {selectedHistoryEntry.goadTask.endedAt != null && (
                                <>
                                  <span className="text-border mx-1">→</span>
                                  {formatTaskInstant(selectedHistoryEntry.goadTask.endedAt)}
                                  <span className="text-border mx-1">·</span>
                                  {formatDuration(
                                    selectedHistoryEntry.goadTask.startedAt,
                                    selectedHistoryEntry.goadTask.endedAt,
                                  )}
                                </>
                              )}
                            </p>
                            <p>{selectedHistoryEntry.goadTask.lineCount} lines</p>
                            <code
                              className="block text-[11px] text-primary/90 break-all max-h-20 overflow-y-auto"
                              title={selectedHistoryEntry.goadTask.command}
                            >
                              {selectedHistoryEntry.goadTask.command.length > 200
                                ? `${selectedHistoryEntry.goadTask.command.slice(0, 197)}…`
                                : selectedHistoryEntry.goadTask.command}
                            </code>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
                    <GoadTerminal
                      lines={historyDeployLines}
                      label={`Range Logs — ${instance?.ludusRangeId ?? "no range"}${
                        selectedHistoryEntry.deployEntry
                          ? ` · ${
                              selectedHistoryEntry.mergedBatchDeploys?.length
                                ? aggregateDeployStatuses(selectedHistoryEntry.mergedBatchDeploys)
                                : selectedHistoryEntry.deployEntry.status
                            }`
                          : ""
                      }`}
                      className="flex flex-col min-h-0 h-full"
                    />
                    <GoadTerminal
                      lines={historyGoadLines}
                      label={`GOAD Logs — ${instanceId}${selectedHistoryEntry.goadTask ? ` · ${selectedHistoryEntry.goadTask.command}` : ""}`}
                      className="flex flex-col min-h-0 h-full"
                    />
                  </div>
                </>
              )}
            </div>
          ) : (
            /* ── List view: correlated entries ── */
            <>
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <p className="text-xs text-muted-foreground">
                  Deployment history for this instance — click an entry to view side-by-side logs.
                </p>
                <Button size="sm" variant="ghost" onClick={fetchAllHistory} disabled={historyLoading || deployHistoryLoading}>
                  <RefreshCw className={cn("h-3.5 w-3.5", (historyLoading || deployHistoryLoading) && "animate-spin")} />
                </Button>
              </div>
              {(historyLoading || deployHistoryLoading) ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (() => {
                const correlated = correlateHistoryEntries(deployHistory, taskHistory)
                if (correlated.length === 0 && taskHistory.length === 0) {
                  return (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No recorded operations for this instance yet
                    </div>
                  )
                }
                // List branch only renders when `selectedHistoryEntry` is null — no row highlighted.
                return (
                  <div className="space-y-2 overflow-y-auto flex-1">
                    {correlated.map((entry, idx) => (
                      <CorrelatedHistoryRow
                        key={
                          entry.mergedBatchDeploys && entry.mergedBatchDeploys.length > 0
                            ? `${entry.goadTask?.id ?? "goad"}-merged`
                            : entry.deployEntry?.id ?? entry.goadTask?.id ?? idx
                        }
                        row={entry}
                        selectedId={null}
                        showTemplate
                        onSelectRow={(row) => void handleSelectHistoryEntry(row)}
                      />
                    ))}
                  </div>
                )
              })()}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function GoadInstanceRoute() {
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
