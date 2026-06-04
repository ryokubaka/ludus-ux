"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { GoadTerminal, useGoadStream } from "@/components/goad/goad-terminal"
import {
  Terminal,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Play,
  Puzzle,
  Check,
  Loader2,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Info,
  StopCircle,
  Server,
  PackageCheck,
  PackageX,
  CircleAlert,
  Tag,
  Shield,
} from "lucide-react"
import Link from "next/link"
import type { GoadLabDef, GoadExtensionDef, GoadCatalog, GoadInstance, TemplateObject } from "@/lib/types"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { ludusApi, getImpersonationHeaders, pruneKnownHosts } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { fetchDeployElapsedAnchorMs } from "@/lib/range-deploy-elapsed-anchor"
import { goadChainDebug } from "@/lib/goad-chain-debug"
import { useDeployLogContext } from "@/lib/deploy-log-context"
import { useRange } from "@/lib/range-context"
import { useImpersonation } from "@/lib/impersonation-context"
import { useShellSession } from "@/components/providers/shell-session-provider"
import { NetworkRulesEditor } from "@/components/range/network-rules-editor"
import { type NetworkRule, injectNetworkRules, extractNetworkSection } from "@/lib/network-rules"
import { LUDUS_DEPLOY_TAGS, LUDUS_DEPLOY_TAG_DESCRIPTIONS, filterLudusDeployTags } from "@/lib/ludus-deploy-tags"
import { clearRangeVmsAndWait } from "@/lib/wait-range-vms-cleared"
import { tryToastLudusSlowHttpError } from "@/lib/ludus-timeout-ui"

// ── Template readiness helpers ────────────────────────────────────────────────

/** Returns { present, missing } template lists for a given set of required names */
function checkTemplates(required: string[], builtNames: Set<string>, allNames: Set<string>) {
  const present: string[] = []
  const missingUnbuilt: string[] = [] // installed but not yet built
  const missingAbsent: string[] = []  // not installed at all
  for (const t of required) {
    if (builtNames.has(t)) present.push(t)
    else if (allNames.has(t)) missingUnbuilt.push(t)
    else missingAbsent.push(t)
  }
  return { present, missingUnbuilt, missingAbsent, ready: missingUnbuilt.length === 0 && missingAbsent.length === 0 }
}

/** Inline template chip list for a lab card or extension row */
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

const STEPS = ["Select Lab Type", "Select Extensions", "Select Range", "Network Rules", "Review & Deploy"]

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/** True when GOAD instance.json extensions match wizard selection (order-insensitive). */
function extensionSetsEqual(instanceExtensions: string[] | undefined, wizard: string[]): boolean {
  if (!instanceExtensions || instanceExtensions.length !== wizard.length) return false
  const a = [...instanceExtensions].sort()
  const b = [...wizard].sort()
  return a.every((v, i) => v === b[i])
}

/**
 * Single stdin `--repl` session: after `set_extensions` + workspace (`create_empty` or `use`),
 * with extensions we run `provide` → `prepare_jumpbox` → `provision_lab` → one
 * `provision_extension` per ext (one Ludus deploy). We avoid REPL `install`, which
 * would call `install_extension` per ext and re-run `ludus range deploy` each time.
 *
 * Re-use path: same decomposed tail only if instance.json extensions already match
 * the wizard (otherwise `install` so GOAD can `enable_extension` + deploy for new ext).
 */
function ludusWizardInstallArgs(
  selectedLab: string,
  exts: string[],
  mode:
    | { kind: "fresh" }
    | { kind: "existing"; instanceId: string; useDecomposedExtensionProvisioning: boolean },
): string {
  if (exts.length === 0) {
    return mode.kind === "existing"
      ? `--repl "use ${shellQuote(mode.instanceId)};update_instance_files;install"`
      : `-l ${shellQuote(selectedLab)} -p ludus -m local -t install`
  }
  const extList = exts.join(" ")
  const postWorkspaceInstall = [
    "provide",
    "prepare_jumpbox",
    "provision_lab",
    ...exts.map((e) => `provision_extension ${e}`),
  ].join(";")

  if (mode.kind === "existing") {
    // instance.json is synced via refresh-workspace API before GOAD runs; REPL then
    // reloads the instance and update_instance_files regenerates config.yml + inventories.
    const head = `unload;use ${mode.instanceId};set_extensions ${extList};update_instance_files`
    const tail = mode.useDecomposedExtensionProvisioning ? postWorkspaceInstall : "install"
    return `--repl "${head};${tail}"`
  }

  const setup = [
    "unload",
    `set_lab ${selectedLab}`,
    "set_provider ludus",
    "set_provisioning_method local",
    `set_extensions ${extList}`,
    "create_empty",
  ].join(";")
  return `--repl "${setup};${postWorkspaceInstall}"`
}

export default function NewGoadInstancePage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ranges: accessibleRanges, selectRange, refreshRanges, selectedRangeId } = useRange()
  const { impersonation, impersonationHeaders } = useImpersonation()
  const shell = useShellSession()
  const [step, setStep] = useState(0)
  const [selectedLab, setSelectedLab] = useState<string | null>(null)
  const [selectedExtensions, setSelectedExtensions] = useState<Set<string>>(new Set())
  const [deployed, setDeployed] = useState(false)
  const [creatingRange, setCreatingRange] = useState(false)
  const [dedicatedRangeId, setDedicatedRangeId] = useState<string | null>(null)
  const [currentUsername, setCurrentUsername] = useState<string>("")

  // Step 3: Network Rules
  const [networkRules, setNetworkRules] = useState<NetworkRule[]>([])

  // Optional Ludus deploy tags — set from Review & Deploy (advanced panel); forwarded to `ludus range deploy --tags`
  const [selectedLudusDeployTags, setSelectedLudusDeployTags] = useState<string[]>([])
  const [showLudusDeployTagsPanel, setShowLudusDeployTagsPanel] = useState(false)

  // Range selection (step 2)
  const [rangeMode, setRangeMode] = useState<"new" | "existing">("new")
  const [selectedExistingRange, setSelectedExistingRange] = useState<string>("")

  // Stable UID shared between the auto-generated range name and GOAD instance ID.
  // Using the same UID means the range suffix visually matches the instance name suffix,
  // making it easy to see which range belongs to which instance.
  // 6 chars gives ~2 billion combinations — low collision risk per user.
  const [newRangeUid] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase())
  // True while we are deleting existing VMs before a GOAD install into an existing range
  const [clearingRange, setClearingRange] = useState(false)
  // Existing GOAD instance that lives in the currently-selected existing range (if any)
  const [existingInstanceInSelectedRange, setExistingInstanceInSelectedRange] = useState<string | null>(null)

  // When the user picks an existing range, check if there is already a GOAD instance
  // in it.  This drives the review step copy ("re-deploy" vs "fresh install").
  useEffect(() => {
    if (rangeMode !== "existing" || !selectedExistingRange) {
      setExistingInstanceInSelectedRange(null)
      return
    }
    fetch("/api/goad/instances", { headers: getImpersonationHeaders() })
      .then((r) => r.ok ? r.json() : { instances: [] })
      .then((d) => {
        const found = (d.instances ?? []).find(
          (i: { instanceId: string; ludusRangeId?: string }) => i.ludusRangeId === selectedExistingRange
        )
        setExistingInstanceInSelectedRange(found?.instanceId ?? null)
      })
      .catch(() => setExistingInstanceInSelectedRange(null))
  }, [rangeMode, selectedExistingRange]) // eslint-disable-line react-hooks/exhaustive-deps

  // Template readiness
  const [templates, setTemplates] = useState<TemplateObject[]>([])
  const builtNames = new Set(templates.filter((t) => t.built).map((t) => t.name))
  const allNames   = new Set(templates.map((t) => t.name))

  // Fetch the current effective username for range naming.
  // When impersonating, immediately use the impersonated user's ID rather than
  // waiting for the session fetch (which always returns the admin's username).
  // This effect re-runs whenever the impersonation state changes so the range
  // name preview always reflects the actual owner.
  useEffect(() => {
    if (impersonation?.username) {
      setCurrentUsername(impersonation.username)
      return
    }
    if (shell?.username) {
      setCurrentUsername(shell.username)
      return
    }
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => { if (d.username) setCurrentUsername(d.username) })
      .catch(() => {})
  }, [impersonation?.username, shell]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch installed templates (once on mount — not affected by impersonation)
  useEffect(() => {
    fetch("/api/proxy/templates")
      .then((r) => r.ok ? r.json() : [])
      .then((d) => {
        const list: TemplateObject[] = Array.isArray(d) ? d : (d?.result ?? [])
        setTemplates(list)
      })
      .catch(() => {})
  }, [])
  const { lines, isRunning, exitCode, taskId: goadTaskId, run, stop, clear } = useGoadStream({
    getExtraHeaders: impersonationHeaders,
  })
  // Keep a ref so async closures (handleDeploy) can read the latest taskId without
  // a stale closure — same pattern as goad/[id]/page.tsx.
  const goadTaskIdRef = useRef<string | null>(null)
  goadTaskIdRef.current = goadTaskId

  /** Wait for execute SSE to emit [TASKID] so redirect can pass ?goadTaskId= for log resume. */
  const waitForGoadTaskId = async (maxMs = 5_000): Promise<string | null> => {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      const tid = goadTaskIdRef.current?.trim()
      if (tid) return tid
      await new Promise((r) => setTimeout(r, 100))
    }
    return goadTaskIdRef.current?.trim() ?? null
  }

  const toggleLudusDeployTag = useCallback((tag: string) => {
    setSelectedLudusDeployTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }, [])

  const {
    lines: rangeLogLines,
    isStreaming: isRangeStreaming,
    rangeState,
    activeRangeId,
    startStreaming: startRangeStreaming,
    stopStreaming: stopRangeStreaming,
    clearLogs: clearRangeLogs,
    refreshRangeStateFromServer,
  } = useDeployLogContext()

  const rangeLogRefreshLock = useRef(false)
  const [rangeLogRefreshBusy, setRangeLogRefreshBusy] = useState(false)
  const handleRefreshRangeLogs = useCallback(() => {
    const rid = (dedicatedRangeId ?? activeRangeId)?.trim()
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
    dedicatedRangeId,
    activeRangeId,
    stopRangeStreaming,
    startRangeStreaming,
    refreshRangeStateFromServer,
  ])

  // Catalog state
  const [catalog, setCatalog] = useState<GoadCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const fetchCatalog = async (refresh = false) => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const res = await fetch("/api/goad/catalog", {
        method: refresh ? "POST" : "GET",
      })
      const data: GoadCatalog & { error?: string; message?: string } = await res.json()
      if (data.error) {
        setCatalogError(data.error)
      } else if (!data.configured) {
        setCatalogError(data.message || "GOAD SSH not configured")
      } else {
        setCatalog(data)
      }
    } catch (err) {
      setCatalogError((err as Error).message)
    }
    setCatalogLoading(false)
  }

  useEffect(() => { fetchCatalog() }, [])

  const toggleExtension = (name: string) => {
    setSelectedExtensions((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // Extensions compatible with the selected lab
  const compatExtensions: GoadExtensionDef[] = (catalog?.extensions ?? []).filter((ext) => {
    if (!selectedLab) return true
    return ext.compatibility.includes("*") || ext.compatibility.includes(selectedLab)
  })

  // Preview of the auto-generated Ludus range ID for the "Create New Range" option.
  // e.g. "melchior-GOAD-Mini-A1B2C3" — 6-char UID gives ~2 billion combinations.
  // When impersonating, use the impersonated user's username so the range name
  // reflects the actual owner, not the admin performing the action.
  // impersonation?.username is listed as a direct dep so the memo updates the
  // instant the provider loads the stored impersonation state (before the session
  // fetch resolves and potentially sets currentUsername to the admin's name).
  const autoRangeId = useMemo(() => {
    const effective = impersonation?.username || currentUsername
    const user    = (effective || "user").toLowerCase().replace(/[^a-z0-9]/g, "")
    const labSlug = (selectedLab ?? "lab").replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "")
    return `${user}-${labSlug}-${newRangeUid}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impersonation?.username, currentUsername, selectedLab, newRangeUid])

  /**
   * Always creates a fresh dedicated Ludus range for this GOAD deployment.
   *
   * We intentionally never reuse an existing range — even an empty one.
   * The "reuse empty range" optimisation was removed because GET /range only
   * returns the user's *default* range, so an empty `melchior` would be
   * mistakenly picked, setting LUDUS_RANGE_ID=melchior and causing GOAD's
   * internal `ludus range rm` to destroy the user's primary range.
   *
   * On failure returns `{ ok: false, error }` so the caller can stop before GOAD
   * runs without LUDUS_RANGE_ID (which would target the user's default range).
   */
  const resolveDeployRange = async (): Promise<
    | { ok: true; rangeId: string; created: boolean }
    | { ok: false; error: string }
  > => {
    // Always create a new dedicated range.
    // Naming convention: <user>-<labname>-<uid>  e.g. "melchior-GOAD-Mini-LDQ8"
    // Uses the stable newRangeUid so the preview shown in step 2 matches the actual ID.
    const candidateId = autoRangeId
    const displayName = candidateId

    try {
      // Include impersonation headers so the route assigns the range to the
      // correct user (admin impersonation is forwarded transparently).
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...getImpersonationHeaders(),
      }

      const res = await fetch("/api/range/create", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          rangeID: candidateId,
          name: displayName,
          description: `Dedicated Ludus range for ${selectedLab} instance`,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.ok || res.status === 409) {
        return { ok: true, rangeId: candidateId, created: true }
      }
      const msg =
        typeof data.error === "string" && data.error.trim()
          ? data.error
          : `Ludus returned HTTP ${res.status}`
      console.warn("Range creation failed:", msg)
      return { ok: false, error: msg }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn("Range creation error:", err)
      return { ok: false, error: msg }
    }
  }

  const handleDeploy = async () => {
    if (!selectedLab) return

    const deployTagsForRun = filterLudusDeployTags(selectedLudusDeployTags)
    const ludusDeployTagsOpt = deployTagsForRun.length > 0 ? deployTagsForRun : undefined

    // [P3] Snapshot instance lists in parallel — user + admin view when impersonating.
    // Both fetches are independent so there's no reason to run them sequentially.
    const impHeaders = getImpersonationHeaders()
    const isImpersonating = Object.keys(impHeaders).length > 0
    type InstanceSnapshot = GoadInstance
    let instancesBefore: InstanceSnapshot[] = []
    try {
      const fetchUser = fetch("/api/goad/instances", { credentials: "include", headers: impHeaders })
      const fetchAdmin = isImpersonating ? fetch("/api/goad/instances", { credentials: "include" }) : Promise.resolve(null)
      const [userRes, adminRes] = await Promise.all([fetchUser, fetchAdmin])
      if (userRes.ok) instancesBefore = (await userRes.json()).instances ?? []
      if (adminRes?.ok) {
        const adminIds = ((await adminRes.json()).instances ?? []) as GoadInstance[]
        for (const inst of adminIds) {
          if (!instancesBefore.some((i) => i.instanceId === inst.instanceId)) {
            instancesBefore.push(inst)
          }
        }
      }
    } catch { /* best-effort */ }
    const instanceIdsBefore = new Set(instancesBefore.map((i) => i.instanceId))

    let rangeId: string | null = null
    if (rangeMode === "existing" && selectedExistingRange) {
      rangeId = selectedExistingRange
      setDedicatedRangeId(rangeId)
      selectRange(rangeId)
    } else {
      setCreatingRange(true)
      try {
        const result = await resolveDeployRange()
        if (!result.ok) {
          toast({
            variant: "destructive",
            title: "Could not create Ludus range",
            description: result.error,
          })
          return
        }
        rangeId = result.rangeId
        setDedicatedRangeId(rangeId)
        await refreshRanges()
        selectRange(rangeId)
      } finally {
        setCreatingRange(false)
      }
    }

    // Dedicated range is mandatory for the "new range" wizard path — without it,
    // GOAD would run against the account default range.
    if (rangeMode === "new" && !rangeId) {
      toast({
        variant: "destructive",
        title: "No Ludus range selected",
        description: "Pick an existing range or fix range creation, then try again.",
      })
      return
    }

    // If the user defined custom firewall rules, write them to the range config
    // before GOAD starts. GOAD's ansible will apply the network tag and enforce them.
    if (networkRules.length > 0 && rangeId) {
      try {
        await ludusApi.setRangeConfig(injectNetworkRules("", networkRules), rangeId)
      } catch { /* Non-fatal — GOAD can still deploy, rules can be set post-deploy */ }
    }

    // Show the terminal view.  Range log streaming is started by /goad/[id]'s
    // useEffect once isRunning becomes true after the redirect.
    setDeployed(true)

    const exts = Array.from(selectedExtensions)

    // Build pending-network snapshot for the handoff so the server can re-apply
    // it after GOAD finishes, even if the user navigates away.
    const networkSnapshot =
      networkRules.length > 0
        ? extractNetworkSection(injectNetworkRules("", networkRules))
        : null
    const networkRulesJson = networkSnapshot ? JSON.stringify(networkSnapshot) : undefined

    // ── Determine whether we're reusing an existing instance ─────────────────
    // When the user picks "existing range", there may already be a GOAD instance
    // associated with that range.  In that case we want to keep the same instance
    // ID — we just delete the VMs and re-run install targeting the same workspace.
    // No polling is needed: we know the destination before GOAD even starts.
    //
    // If there is no prior instance in the range (or this is a new range), we fall
    // through to the normal "fresh install + poll for new instance" path.
    const existingInstance =
      rangeMode === "existing" && rangeId
        ? (instancesBefore.find((i) => i.ludusRangeId === rangeId) ?? null)
        : null

    if (existingInstance) {
      // ── Re-deploy path: reuse existing GOAD instance ────────────────────────
      const targetRangeId: string = rangeId!
      const existingId = existingInstance.instanceId

      // [server-handoff] Persist rangeId + instanceId + network rules to the DB
      // before the execute call. This lets the server complete post-deploy linkage
      // even if the user navigates away after clicking Deploy.
      let handoffId: string | null = null
      if (rangeId) {
        const hRes = await fetch("/api/goad/deploy-handoff", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...impHeaders },
          body: JSON.stringify({ rangeId, instanceId: existingId, networkRules: networkRulesJson }),
        }).catch(() => null)
        if (hRes?.ok) handoffId = (await hRes.json()).handoffId ?? null
      }

      // Drain VMs before GOAD — Ludus dynamic inventory fails if ansible runs
      // while Proxmox VMs are still being destroyed (403 / empty inventory).
      setClearingRange(true)
      try {
        const preClear = await ludusApi.getRangeStatus(targetRangeId)
        const ips =
          preClear.data?.VMs?.map((v) => v.ip).filter((ip) => typeof ip === "string" && ip.trim() !== "") ?? []
        const cleared = await clearRangeVmsAndWait(targetRangeId)
        if (!cleared.ok) {
          if (
            tryToastLudusSlowHttpError({
              toast,
              error: cleared.error,
              slowTitle: "Slow response from Ludus",
              onSlow: () => void refreshRanges(),
            })
          ) {
            return
          }
          toast({
            variant: "destructive",
            title: "Could not clear range VMs",
            description: cleared.error,
          })
          return
        }
        if (ips.length > 0) void pruneKnownHosts(ips)
      } finally {
        setClearingRange(false)
      }

      // Sync instance.json extensions + drop stale inventories before GOAD regen.
      const refreshRes = await fetch(
        `/api/goad/instances/${encodeURIComponent(existingId)}/refresh-workspace`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...impHeaders },
          body: JSON.stringify({ extensions: exts }),
        },
      )
      if (!refreshRes.ok) {
        const refreshErr = await refreshRes.json().catch(() => ({}))
        toast({
          variant: "destructive",
          title: "Could not refresh GOAD workspace",
          description: (refreshErr as { error?: string }).error ?? `HTTP ${refreshRes.status}`,
        })
        return
      }

      // 2. Run GOAD: one REPL session — decomposed `provide` + `provision_lab` +
      // `provision_extension` per ext when instance extensions match wizard (else `install`).
      const useDecomposed = extensionSetsEqual(existingInstance.extensions, exts)
      const args = ludusWizardInstallArgs(selectedLab, exts, {
        kind: "existing",
        instanceId: existingId,
        useDecomposedExtensionProvisioning: useDecomposed,
      })
      goadChainDebug("goad_install_issued", {
        path: "reuse-instance",
        rangeId: rangeId ?? null,
        lab: selectedLab,
        extensions: exts,
        argsHead: args.slice(0, 240),
      })
      void run(
        args,
        existingId,
        impersonation ? { username: impersonation.username } : undefined,
        rangeId ?? undefined,
        ludusDeployTagsOpt,
      )

      const taskIdForRedirect = await waitForGoadTaskId()

      // [P6] Fire-and-forget the server-side linkage calls. The handoff route
      // already persisted the mapping so these are best-effort metadata updates.
      void (async () => {
        const taskId = goadTaskIdRef.current ?? taskIdForRedirect
        if (taskId) {
          if (handoffId) {
            fetch("/api/goad/deploy-handoff", {
              method: "PATCH",
              credentials: "include",
              headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
              body: JSON.stringify({ handoffId, taskId }),
            }).catch(() => {})
          }
          fetch(`/api/goad/tasks/${taskId}/link-instance`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
            body: JSON.stringify({ instanceId: existingId }),
          }).catch(() => {})
        }
        if (rangeId) {
          fetch("/api/goad/instances/set-range", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
            body: JSON.stringify({ rangeId, instanceIds: [existingId] }),
          }).catch(() => {})
        }
      })()

      selectRange(targetRangeId)
      void refreshRanges()
      const taskQ = taskIdForRedirect
        ? `&goadTaskId=${encodeURIComponent(taskIdForRedirect)}`
        : ""
      router.push(`/goad/${encodeURIComponent(existingId)}?tab=deploy${taskQ}`)

    } else {
      // ── Fresh install path ───────────────────────────────────────────────────
      // No prior instance in this range. GOAD generates its own instance ID so
      // we cannot predetermine it; poll until it appears (within ~30–60 s).

      // [server-handoff] Persist rangeId + network rules to the DB before execute.
      // instanceId is null here — we link it once GOAD creates the workspace.
      let handoffId: string | null = null
      if (rangeId) {
        const hRes = await fetch("/api/goad/deploy-handoff", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...impHeaders },
          body: JSON.stringify({ rangeId, networkRules: networkRulesJson }),
        }).catch(() => null)
        if (hRes?.ok) handoffId = (await hRes.json()).handoffId ?? null
      }

      if (rangeMode === "existing" && rangeId) {
        const targetRangeId = rangeId
        setClearingRange(true)
        try {
          const preClear = await ludusApi.getRangeStatus(targetRangeId)
          const ips =
            preClear.data?.VMs?.map((v) => v.ip).filter((ip) => typeof ip === "string" && ip.trim() !== "") ?? []
          const cleared = await clearRangeVmsAndWait(targetRangeId)
          if (!cleared.ok) {
            if (
              tryToastLudusSlowHttpError({
                toast,
                error: cleared.error,
                slowTitle: "Slow response from Ludus",
                onSlow: () => void refreshRanges(),
              })
            ) {
              return
            }
            toast({
              variant: "destructive",
              title: "Could not clear range VMs",
              description: cleared.error,
            })
            return
          }
          if (ips.length > 0) void pruneKnownHosts(ips)
        } finally {
          setClearingRange(false)
        }
      }

      const args = ludusWizardInstallArgs(selectedLab, exts, { kind: "fresh" })
      goadChainDebug("goad_install_issued", {
        path: "fresh-install",
        rangeId: rangeId ?? null,
        lab: selectedLab,
        extensions: exts,
        argsHead: args.slice(0, 240),
      })
      run(args, undefined, impersonation ? { username: impersonation.username } : undefined, rangeId ?? undefined, ludusDeployTagsOpt)

      // Poll until GOAD creates the new workspace directory, then redirect.
      // GOAD writes instance.json early in the install flow (within ~30–60 s).
      // [P1] Poll every 3 s (was 10 s) and limit to 5 min (was 30 min) since
      //      the instance appears almost immediately after GOAD's init phase.
      const capturedRangeId = rangeId
      const capturedHandoffId = handoffId
      const capturedBefore = new Set(instanceIdsBefore)
      let redirected = false

      const pollForInstance = async () => {
        const deadline = Date.now() + 5 * 60 * 1000
        while (Date.now() < deadline && !redirected) {
          await new Promise((r) => setTimeout(r, 3_000))
          try {
            const curHeaders = getImpersonationHeaders()
            const res = await fetch("/api/goad/instances", {
              credentials: "include",
              headers: curHeaders,
            })
            if (!res.ok) continue
            const data = await res.json()
            let newInst = (data.instances ?? []).find(
              (i: { instanceId: string }) => !capturedBefore.has(i.instanceId)
            )
            // Fallback admin-view when impersonating
            if (!newInst && Object.keys(curHeaders).length > 0) {
              try {
                const adminRes = await fetch("/api/goad/instances", { credentials: "include" })
                if (adminRes.ok) {
                  const adminData = await adminRes.json()
                  newInst = (adminData.instances ?? []).find(
                    (i: { instanceId: string }) => !capturedBefore.has(i.instanceId)
                  )
                }
              } catch { /* best-effort */ }
            }
            if (newInst && !redirected) {
              redirected = true
              const newId = newInst.instanceId as string
              const taskId = goadTaskIdRef.current

              // [P6] Fire-and-forget all linkage calls before redirect.
              // The handoff already persisted the rangeId on the server, so these
              // are metadata updates that don't block the navigation.
              if (capturedHandoffId && taskId) {
                fetch("/api/goad/deploy-handoff", {
                  method: "PATCH",
                  credentials: "include",
                  headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
                  body: JSON.stringify({ handoffId: capturedHandoffId, taskId }),
                }).catch(() => {})
              }
              if (capturedRangeId) {
                fetch("/api/goad/instances/set-range", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
                  body: JSON.stringify({ rangeId: capturedRangeId, instanceIds: [newId] }),
                }).catch(() => {})
              }
              if (taskId) {
                fetch(`/api/goad/tasks/${taskId}/link-instance`, {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
                  body: JSON.stringify({ instanceId: newId }),
                }).catch(() => {})
              }
              if (networkRulesJson) {
                fetch(`/api/goad/instances/${encodeURIComponent(newId)}/pending-network`, {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: networkRulesJson,
                }).catch(() => {})
              }
              if (capturedRangeId) selectRange(capturedRangeId)
              void refreshRanges()
              const taskQ = taskId
                ? `&goadTaskId=${encodeURIComponent(taskId)}`
                : ""
              router.push(`/goad/${encodeURIComponent(newId)}?tab=deploy${taskQ}`)
            }
          } catch { /* retry */ }
        }
      }

      pollForInstance()
    }
  }

  const handleStop = async () => {
    await stop()
    stopRangeStreaming()

    // Abort only the ranges we explicitly know are associated with this GOAD
    // deployment.  Never send a bare /range/abort (no rangeID) — that targets
    // the server-side default range and can accidentally abort a completely
    // different, concurrently-deploying range owned by the same user.
    const rangesToAbort = new Set<string>()
    if (dedicatedRangeId) rangesToAbort.add(dedicatedRangeId)

    await Promise.all(
      Array.from(rangesToAbort).map((rid) =>
        fetch(`/api/proxy/range/abort?rangeID=${encodeURIComponent(rid)}`, { method: "POST" }).catch(() => {})
      )
    )
  }

  const labInfo: GoadLabDef | undefined = catalog?.labs.find((l) => l.name === selectedLab)

  const showTerminal = step === 4 && (deployed || isRunning)

  return (
    <div className={cn(
      showTerminal
        ? "flex flex-col flex-1 min-h-0 gap-3 w-full"
        : "w-full max-w-7xl 2xl:max-w-[min(90rem,96vw)] mx-auto space-y-6 px-1 sm:px-0",
    )}>
      <div className="flex items-center gap-3 flex-shrink-0">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href="/goad">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Deploy New GOAD Instance</h1>
          <p className="text-xs text-muted-foreground">Install a Game of Active Directory instance on your Ludus server</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold",
                i < step
                  ? "bg-green-500/20 text-green-400 border border-green-500/40"
                  : i === step
                  ? "bg-primary/20 text-primary border border-primary/40"
                  : "bg-muted text-muted-foreground border border-border"
              )}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={cn("text-sm", i === step ? "text-foreground font-medium" : "text-muted-foreground")}>
              {s}
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Catalog error / not configured */}
      {catalogError && (
        <Alert variant={catalogError.includes("not configured") ? "default" : "destructive"}>
          <Info className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span className="text-sm">{catalogError}</span>
            <Button size="sm" variant="ghost" onClick={() => fetchCatalog(true)} disabled={catalogLoading}>
              <RefreshCw className={cn("h-3 w-3", catalogLoading && "animate-spin")} />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Step 0: Select Lab */}
      {step === 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Choose the lab type to deploy:</p>
            <Button variant="ghost" size="sm" onClick={() => fetchCatalog(true)} disabled={catalogLoading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", catalogLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>

          {catalogLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 w-full rounded-lg bg-muted/50 animate-pulse" />
              ))}
            </div>
          ) : !catalogError && catalog ? (
            <div className="grid gap-2">
              {catalog.labs.map((lab) => {
                const ludusOk  = lab.ludusSupported !== false  // treat missing field as true (older catalog)
                const tpl      = checkTemplates(lab.requiredTemplates ?? [], builtNames, allNames)
                const tplOk    = tpl.ready || (lab.requiredTemplates ?? []).length === 0
                const canSelect = ludusOk && tplOk
                const isSelected = selectedLab === lab.name
                return (
                  <button
                    key={lab.name}
                    disabled={!canSelect}
                    className={cn(
                      "text-left p-4 rounded-lg border-2 transition-all",
                      !canSelect && "opacity-50 cursor-not-allowed",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : canSelect
                        ? "border-border hover:border-primary/50"
                        : "border-border"
                    )}
                    onClick={() => {
                      if (!canSelect) return
                      setSelectedLab(lab.name)
                      setSelectedExtensions(new Set())
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-mono font-bold text-primary">{lab.name}</code>
                          <Badge variant="secondary" className="text-xs">{lab.vmCount} VMs</Badge>
                          {lab.domains > 0 && (
                            <Badge variant="secondary" className="text-xs">{lab.domains} domain{lab.domains !== 1 ? "s" : ""}</Badge>
                          )}
                          {/* Incompatible takes priority over missing-templates */}
                          {!ludusOk && (
                            <Badge variant="secondary" className="text-xs gap-1 text-muted-foreground">
                              No Ludus provider
                            </Badge>
                          )}
                          {ludusOk && !tplOk && (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <PackageX className="h-2.5 w-2.5" /> Missing templates
                            </Badge>
                          )}
                          {canSelect && (lab.requiredTemplates ?? []).length > 0 && (
                            <Badge variant="success" className="text-xs gap-1">
                              <PackageCheck className="h-2.5 w-2.5" /> Ready
                            </Badge>
                          )}
                        </div>
                        {lab.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{lab.description}</p>
                        )}
                        {!ludusOk ? (
                          <p className="text-[10px] text-muted-foreground/50 mt-1.5 italic">
                            No <code>providers/ludus/</code> directory — this lab cannot be deployed with Ludus
                          </p>
                        ) : (lab.requiredTemplates ?? []).length > 0
                          ? <TemplateChips required={lab.requiredTemplates} builtNames={builtNames} allNames={allNames} />
                          : <p className="text-[10px] text-muted-foreground/50 mt-1.5 italic">No template requirements detected — hit Refresh if this seems wrong</p>
                        }
                      </div>
                      {isSelected && (
                        <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </div>
                  </button>
                )
              })}

              {catalog.labs.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No labs found in <code className="text-primary">{catalog.goadPath}/ad/</code>
                </div>
              )}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={() => setStep(1)} disabled={!selectedLab || catalogLoading}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

        </div>
      )}

      {/* Step 1: Extensions */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Select optional extensions for <code className="text-primary font-mono">{selectedLab}</code>:
            </p>
            <Badge variant="secondary">{selectedExtensions.size} selected</Badge>
          </div>

          {compatExtensions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No extensions available for this lab
            </div>
          ) : (
            <div className="grid gap-2">
              {compatExtensions.map((ext) => {
                const tpl = checkTemplates(ext.requiredTemplates ?? [], builtNames, allNames)
                const canEnable = tpl.ready || (ext.requiredTemplates ?? []).length === 0
                const isSelected = selectedExtensions.has(ext.name)
                return (
                  <div
                    key={ext.name}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border transition-all",
                      !canEnable && "opacity-50 cursor-not-allowed",
                      isSelected && canEnable
                        ? "border-primary bg-primary/5"
                        : canEnable
                        ? "border-border hover:border-primary/30 cursor-pointer"
                        : "border-border"
                    )}
                    onClick={() => canEnable && toggleExtension(ext.name)}
                  >
                    <Checkbox
                      checked={isSelected}
                      disabled={!canEnable}
                      onCheckedChange={() => canEnable && toggleExtension(ext.name)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Puzzle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <code className="font-mono text-xs font-medium text-primary">{ext.name}</code>
                        {ext.machines.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            +{ext.machines.length} VM{ext.machines.length !== 1 ? "s" : ""}
                          </span>
                        )}
                        {!canEnable && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <PackageX className="h-2.5 w-2.5" /> Missing templates
                          </Badge>
                        )}
                      </div>
                      {ext.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{ext.description}</p>
                      )}
                      {ext.impact && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{ext.impact}</p>
                      )}
                      {(ext.requiredTemplates ?? []).length > 0 && (
                        <TemplateChips required={ext.requiredTemplates} builtNames={builtNames} allNames={allNames} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(2)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Select Range */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Target Range</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button variant={rangeMode === "new" ? "default" : "outline"} size="sm"
                  onClick={() => setRangeMode("new")}>
                  Create New Range
                </Button>
                <Button variant={rangeMode === "existing" ? "default" : "outline"} size="sm"
                  onClick={() => setRangeMode("existing")}>
                  Use Existing Range
                </Button>
              </div>

              <Separator />

              {rangeMode === "new" ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    A new dedicated Ludus range will be created for this GOAD instance:
                  </p>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <Server className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <code className="text-sm font-mono text-primary">{autoRangeId}</code>
                    <Badge variant="secondary" className="ml-auto text-[10px]">new</Badge>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Select the range to deploy this GOAD instance into:
                  </p>
                  {accessibleRanges.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No accessible ranges found. Create a new one instead.</p>
                  ) : (
                    <div className="grid gap-2">
                      {accessibleRanges.map((r) => (
                        <button key={r.rangeID} onClick={() => setSelectedExistingRange(r.rangeID)}
                          className={cn(
                            "text-left p-3 rounded-lg border-2 transition-all",
                            selectedExistingRange === r.rangeID
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-primary/50"
                          )}>
                          <div className="flex items-center justify-between">
                            <code className="font-mono font-bold text-primary text-sm">{r.rangeID}</code>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-[10px]">{r.accessType}</Badge>
                              {selectedExistingRange === r.rangeID && <Check className="h-4 w-4 text-primary" />}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs space-y-1">
                      <p><strong>All existing VMs in the selected range will be destroyed.</strong></p>
                      <p>
                        GOAD runs <code className="font-mono">ludus range rm</code> on the target range before deploying,
                        which deletes every VM currently in it. The range itself is preserved.
                        Only choose an existing range if you are comfortable losing its current VMs.
                      </p>
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={rangeMode === "existing" && !selectedExistingRange}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Network Rules */}
      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4" /> Firewall Rules
                <span className="text-xs text-muted-foreground font-normal">(optional)</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Define custom iptables rules for the GOAD range router. Leave empty to use Ludus
                defaults (all inter-VLAN and external traffic accepted).
              </p>
            </CardHeader>
            <CardContent>
              <NetworkRulesEditor rules={networkRules} onChange={setNetworkRules} availableVlans={[]} />
            </CardContent>
          </Card>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(4)}>
                Skip <ChevronRight className="h-4 w-4" />
              </Button>
              <Button onClick={() => setStep(4)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Review & Deploy */}
      {step === 4 && !showTerminal && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Deployment Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24">Lab</span>
                <code className="font-mono text-sm font-bold text-primary">{selectedLab}</code>
                {labInfo && <Badge variant="secondary">{labInfo.vmCount} VMs</Badge>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24">Range</span>
                <code className="font-mono text-sm text-primary">
                  {rangeMode === "existing" ? selectedExistingRange : autoRangeId}
                </code>
                <Badge variant="secondary" className="text-[10px]">
                  {rangeMode === "existing" ? "existing" : "new"}
                </Badge>
              </div>
              {existingInstanceInSelectedRange && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-24">Instance</span>
                  <code className="font-mono text-sm text-primary">{existingInstanceInSelectedRange}</code>
                  <Badge variant="info" className="text-[10px]">reuse</Badge>
                </div>
              )}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24">Provider</span>
                <span className="text-sm">Ludus</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-xs text-muted-foreground w-24 mt-0.5">Extensions</span>
                <div className="flex flex-wrap gap-1">
                  {selectedExtensions.size === 0 ? (
                    <span className="text-xs text-muted-foreground">None</span>
                  ) : (
                    Array.from(selectedExtensions).map((ext) => (
                      <Badge key={ext} variant="secondary" className="text-xs">{ext}</Badge>
                    ))
                  )}
                </div>
              </div>
              {labInfo?.description && (
                <div className="flex items-start gap-3">
                  <span className="text-xs text-muted-foreground w-24 mt-0.5">Description</span>
                  <span className="text-xs text-muted-foreground">{labInfo.description}</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24">GOAD Path</span>
                <code className="text-xs text-muted-foreground font-mono">{catalog?.goadPath}</code>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24">Firewall Rules</span>
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm">
                    {networkRules.length > 0
                      ? `${networkRules.length} custom rule${networkRules.length !== 1 ? "s" : ""}`
                      : "Ludus defaults"}
                  </span>
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 gap-y-1">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">Ludus deploy tags</span>
                  {filterLudusDeployTags(selectedLudusDeployTags).length > 0 && (
                    <div className="flex flex-wrap gap-1 min-w-0">
                      {filterLudusDeployTags(selectedLudusDeployTags).map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs font-mono">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto gap-1 h-7 text-xs shrink-0"
                    onClick={() => setShowLudusDeployTagsPanel((v) => !v)}
                  >
                    {showLudusDeployTagsPanel ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {showLudusDeployTagsPanel ? "Hide tag options" : "Advanced tag options"}
                  </Button>
                </div>
                {!showLudusDeployTagsPanel && filterLudusDeployTags(selectedLudusDeployTags).length === 0 && (
                  <p className="text-[10px] text-muted-foreground pl-5">
                    Full Ludus Ansible (no <code className="text-primary">--tags</code> filter). Expand to limit deploy steps — same tag list as the range configuration wizard.
                  </p>
                )}
                {showLudusDeployTagsPanel && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                    <p className="text-[10px] text-muted-foreground">
                      Optional: pass <code className="text-primary">--tags</code> to every{" "}
                      <code className="text-primary">ludus range deploy</code> in this GOAD session. Tight sets can break domain or extension steps.
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 max-h-[26rem] overflow-y-auto pr-1">
                      {LUDUS_DEPLOY_TAGS.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className={cn(
                            "flex items-center gap-2 p-2 rounded border text-left transition-colors",
                            selectedLudusDeployTags.includes(tag)
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-primary/50",
                          )}
                          onClick={() => toggleLudusDeployTag(tag)}
                        >
                          <Checkbox
                            checked={selectedLudusDeployTags.includes(tag)}
                            onCheckedChange={() => toggleLudusDeployTag(tag)}
                            className="shrink-0"
                          />
                          <div className="min-w-0">
                            <code className="text-xs font-mono text-primary">{tag}</code>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {LUDUS_DEPLOY_TAG_DESCRIPTIONS[tag] || ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                    {selectedLudusDeployTags.length > 0 && (
                      <div className="flex items-center justify-between pt-1 border-t border-border">
                        <p className="text-xs text-muted-foreground">
                          {selectedLudusDeployTags.length} tag{selectedLudusDeployTags.length !== 1 ? "s" : ""}{" "}
                          selected
                        </p>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedLudusDeployTags([])}>
                          Clear all
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Template readiness summary */}
          {(() => {
            const allRequired = [
              ...(labInfo?.requiredTemplates ?? []),
              ...Array.from(selectedExtensions).flatMap(
                (en) => catalog?.extensions.find((e) => e.name === en)?.requiredTemplates ?? []
              ),
            ]
            const unique = [...new Set(allRequired)]
            if (unique.length === 0) return null
            const summary = checkTemplates(unique, builtNames, allNames)
            return (
              <Card className={cn(
                "border",
                summary.ready ? "border-green-500/30" : "border-red-500/30"
              )}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {summary.ready
                      ? <PackageCheck className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                      : <PackageX className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />}
                    <span className={cn("text-xs font-medium", summary.ready ? "text-green-400" : "text-red-400")}>
                      {summary.ready
                        ? "All required templates are built and ready"
                        : `${summary.missingAbsent.length + summary.missingUnbuilt.length} template${summary.missingAbsent.length + summary.missingUnbuilt.length !== 1 ? "s" : ""} not ready`}
                    </span>
                    <Link href="/templates" className="ml-auto text-[10px] text-primary/70 hover:text-primary underline underline-offset-2">
                      Manage Templates →
                    </Link>
                  </div>
                  <TemplateChips required={unique} builtNames={builtNames} allNames={allNames} />
                </CardContent>
              </Card>
            )
          })()}

          {rangeMode === "existing" ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-1">
                <p>
                  <strong>All existing VMs in range <code className="font-mono">{selectedExistingRange}</code> will be permanently destroyed</strong> before deployment begins.
                </p>
                {existingInstanceInSelectedRange ? (
                  <p>
                    Instance <code className="font-mono">{existingInstanceInSelectedRange}</code> will be <strong>re-deployed</strong> in-place —
                    its lab configuration and inventory files will be overwritten with the new selection.
                    The instance ID is preserved. This cannot be undone.
                  </p>
                ) : (
                  <p>
                    A new GOAD instance will be created in range <code className="font-mono">{selectedExistingRange}</code>.
                    The range itself is not deleted. This cannot be undone.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                This will create a new Ludus range and deploy {labInfo?.vmCount ?? "multiple"} VMs
                to <code className="font-mono">{autoRangeId}</code>.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(3)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={handleDeploy} disabled={isRunning || creatingRange || clearingRange} className="min-w-36">
              {creatingRange
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating range...</>
                : clearingRange
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Clearing VMs...</>
                : <><Play className="h-4 w-4" /> Deploy Instance</>}
            </Button>
          </div>
        </div>
      )}

      {/* ── Side-by-side terminal view ─────────────────────────────────── */}
      {step === 4 && showTerminal && (
        <>
          {/* Redirect notice */}
          <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 flex-shrink-0">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              Deployment is running in the background.
              You will be <strong className="text-foreground">automatically redirected</strong> to the GOAD instance&apos;s Deploy Status page as soon as the instance is detected.
            </p>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3 text-sm flex-wrap">
              {(isRunning || clearingRange || creatingRange) && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              <span className="text-muted-foreground">
                {clearingRange
                  ? <>Clearing VMs from range <code className="text-primary font-mono">{dedicatedRangeId}</code>…</>
                  : <>Deploying <code className="text-primary font-mono">{selectedLab}</code></>}
              </span>
              {dedicatedRangeId && (
                <Badge variant="success" className="gap-1">
                  <Server className="h-3 w-3" /> range: {dedicatedRangeId}
                </Badge>
              )}
              {/* VM clearing phase */}
              {clearingRange && (
                <Badge variant="warning" className="gap-1">
                  <Server className="h-3 w-3" /> Clearing existing VMs
                </Badge>
              )}
              {/* Range deploy phase indicator */}
              {!clearingRange && isRangeStreaming && (
                <Badge variant="warning" className="gap-1">
                  <Server className="h-3 w-3" /> Provisioning VMs
                </Badge>
              )}
              {!isRangeStreaming && rangeState === "SUCCESS" && (
                <Badge variant="success" className="gap-1">
                  <Server className="h-3 w-3" /> VMs Ready
                </Badge>
              )}
              {!isRangeStreaming && rangeState && rangeState !== "SUCCESS" && rangeLogLines.length > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <Server className="h-3 w-3" /> {rangeState}
                </Badge>
              )}
              {exitCode !== null && (exitCode === 0
                ? <Badge variant="success">GOAD Complete</Badge>
                : <Badge variant="destructive">GOAD Failed (exit {exitCode})</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {isRunning && (
                <Button size="sm" variant="destructive" onClick={handleStop}>
                  <StopCircle className="h-3.5 w-3.5" /> Stop
                </Button>
              )}
              {exitCode === 0 && (
                <Button size="sm" asChild>
                  <Link href="/goad"><Terminal className="h-3.5 w-3.5" /> View All Labs</Link>
                </Button>
              )}
            </div>
          </div>

          {/* Side-by-side panels */}
          <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
            {/* Left: Ludus Range Logs */}
            <GoadTerminal
              lines={rangeLogLines}
              onClear={clearRangeLogs}
              onRefresh={(dedicatedRangeId ?? activeRangeId) ? handleRefreshRangeLogs : undefined}
              refreshLoading={rangeLogRefreshBusy}
              label={`Range Logs — Ludus VM Deploy${isRangeStreaming ? " (live)" : rangeState ? ` · ${rangeState}` : ""}`}
              className="flex flex-col min-h-0 h-full"
            />

            {/* Right: GOAD Logs */}
            <GoadTerminal
              lines={lines}
              onClear={clear}
              label={`GOAD Logs — ${selectedLab ?? ""}${isRunning ? " (running)" : exitCode !== null ? ` · exit ${exitCode}` : ""}`}
              className="flex flex-col min-h-0 h-full"
            />
          </div>
        </>
      )}
    </div>
  )
}
