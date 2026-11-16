"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Save,
  Play,
  Loader2,
  AlertTriangle,
  Info,
  CheckCircle2,
  ShieldAlert,
  FileCode2,
  RotateCcw,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { queryKeys } from "@/lib/ui/query-keys"
import { STALE } from "@/lib/ui/query-client"
import { useEffectiveScopeTag } from "@/lib/session/effective-scope-context"
import { useImpersonation } from "@/lib/session/impersonation-context"
import { addPlannedExtensionVms, overlayGoadDomains, pickGoadDirectory, type GoadDirectory, type NamedGoadDirectory } from "@/lib/goad/goad-domain-map"
import { graphForGoadPreview } from "@/lib/goad/goad-preview-graph"
import { mergeGoadPreviewWithNetworkRules, sameNetworkRules } from "@/lib/goad/goad-preview-config"
import {
  coerceAnsibleInstalledSets,
  parseAnsibleInstalledSets,
  serializableAnsibleInstalled,
} from "@/lib/goad/goad-dependency-service"
import { useRange } from "@/lib/range/range-context"
import { useToast } from "@/hooks/use-toast"
import { useConfirm } from "@/hooks/use-confirm"
import { ludusApi } from "@/lib/ui/api"
import { applyBlueprintNetwork, applyBlueprintToRange, pickBlueprintCanvasYaml, readLudusConfigYaml } from "@/lib/blueprints/blueprint-apply"
import { normalizeBlueprintList } from "@/lib/blueprints/blueprint-list-normalize"
import { installedBlueprintMatchesSource, mapRegisteredSources, registeredSourceLabel, sourcesQueryRows } from "@/lib/sources/registered-ludus-sources"
import { fetchSourceCatalog, sourceCatalogItems } from "@/lib/sources/source-catalog-client"
import { postSourceInstall } from "@/lib/sources/source-install-client"
import { blueprintPaletteFromSources } from "@/components/range/builder/builder-blueprints"
import { extractArray, cn } from "@/lib/core/utils"
import { inferOS } from "@/lib/range/range-vm-wizard"
import { substituteRangeIdInConfig } from "@/lib/templates/range-config-templates"
import {
  clearRangeBuilderDraft,
  draftAppliesToSaved,
  rangeBuilderDraftKey,
  rangeBuilderSaveInFlight,
  readRangeBuilderDraft,
  rememberRangeBuilderDraft,
  saveRangeBuilderConfig,
  subscribeRangeBuilderSaves,
} from "@/lib/range/range-builder-session"
import {
  parseRangeDocument,
  serializeRangeDocument,
  canonicalRangeYaml,
  projectGraph,
  setNetworkRules,
  validateGraph,
  hasBlockingFindings,
  documentHasRoles,
  type BuilderGraph,
  type RangeDocument,
} from "@/lib/range/range-builder-document"
import { extractNetworkRules, type NetworkRule } from "@/lib/range/network-rules"
import type { RangeBuilderLayout } from "@/lib/range/range-builder-layout-store"
import type { GoadCatalog, RangeObject, TemplateObject } from "@/lib/core/types"
import {
  ludusRouterVmNameForTemplate,
  resolveRequiredRouterTemplateFromConfig,
} from "@/lib/ludus/ludus-router-template"
import { BuilderAnsibleDepsPanel } from "@/components/range/builder/builder-ansible-deps-panel"
import { useBuilderGoad } from "@/components/range/builder/use-builder-goad"
import { compactLayout } from "@/components/range/builder/builder-types"
import type {
  BlueprintPaletteItem,
  BuilderKind,
  BuilderSurface,
  LiveVmRow,
  RouterDetails,
  TemplateRow,
} from "@/components/range/builder/builder-types"
import { RangeBuilderCanvas, type RangeBuilderCanvasProps } from "@/components/range/builder/range-builder-canvas"
import { goadPickCanDeploy, type GoadPickReadiness } from "@/components/range/builder/goad-lab-choice"
import type { GoadLabPick } from "@/components/range/builder/goad-lab-picker"
import { writeGoadBuilderDeploy } from "@/lib/goad/goad-builder-deploy"
import { DeployApprovalDialog } from "@/components/range/builder/deploy-approval-dialog"

function LoadingRange() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading range</p>
    </div>
  )
}

function RangeBuilderCanvasMount(props: RangeBuilderCanvasProps) {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  if (!ready) return <LoadingRange />
  return <RangeBuilderCanvas {...props} />
}

type LayoutOp =
  | { kind: "patch"; patch: RangeBuilderLayout }
  | { kind: "retarget"; from: string; to: string }
  | { kind: "compact"; positions: RangeBuilderLayout }
  | { kind: "clear-size"; ids: string[] }

function reduceLayout(base: RangeBuilderLayout, ops: readonly LayoutOp[]): RangeBuilderLayout {
  const next: RangeBuilderLayout = { ...base }
  for (const op of ops) {
    switch (op.kind) {
      case "patch":
        for (const [id, pos] of Object.entries(op.patch)) next[id] = { ...next[id], ...pos }
        break
      case "compact": {
        const packed = compactLayout(next, op.positions)
        for (const key of Object.keys(next)) delete next[key]
        Object.assign(next, packed)
        break
      }
      case "clear-size":
        for (const id of op.ids) {
          const pos = next[id]
          if (!pos) continue
          next[id] = { x: pos.x, y: pos.y }
        }
        break
      case "retarget": {
        if (!op.from || op.from === op.to) break
        const pos = next[op.from]
        if (!pos) break
        next[op.to] = pos
        delete next[op.from]
        break
      }
      default: {
        const unreachable: never = op
        return unreachable
      }
    }
  }
  return next
}

function builderSurface(status: RangeObject | null | undefined): BuilderSurface {
  if (!status || status.rangeState === "NEVER DEPLOYED") return "composer"
  return "viewer"
}

function templateRows(data: TemplateObject[] | undefined): TemplateRow[] {
  return (data ?? [])
    .filter((t) => t && typeof t.name === "string")
    .map((t) => {
      const { isWindows, isLinux } = inferOS(t.name)
      const os = t.os ?? (isWindows ? "windows" : isLinux ? "linux" : "other")
      return { name: t.name, built: t.built === true, os: os as TemplateRow["os"] }
    })
}

const EMPTY_PREVIEW_GRAPH: BuilderGraph = {
  vms: [],
  vlans: [],
  domains: [],
  router: { present: false, vmName: null, hostname: null, template: null, ramGb: null, cpus: null },
  rules: [],
  networkDefaults: {},
  rangeDefaults: {},
  trusts: [],
  dependsOn: [],
}

export function RangeBuilderPageClient() {
  const { toast } = useToast()
  const { selectedRangeId, ranges, loading: rangesLoading } = useRange()
  const scopeTag = useEffectiveScopeTag()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()

  const [doc, setDoc] = useState<RangeDocument>(() => parseRangeDocument(""))
  const [originalYaml, setOriginalYaml] = useState("")
  const [saving, setSaving] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [forceLudus, setForceLudus] = useState(false)
  const [depsReady, setDepsReady] = useState(false)
  const [resetNonce, setResetNonce] = useState(0)
  const [blueprintBusyId, setBlueprintBusyId] = useState<string | null>(null)
  const [deployStarted, setDeployStarted] = useState(false)
  const [kindChoice, setKindChoice] = useState<BuilderKind>("ludus")
  const [goadLabPick, setGoadLabPick] = useState<string | null>(null)
  const [goadExtPick, setGoadExtPick] = useState<string[]>([])
  const [previewRuleEdit, setPreviewRuleEdit] = useState<{
    rangeId: string
    key: string
    rules: NetworkRule[]
    base: NetworkRule[]
  } | null>(null)
  const [deployApproval, setDeployApproval] = useState<{
    title: string
    note: string
    yaml: string
    confirmLabel: string
    run: () => void
  } | null>(null)
  const [goadEnabled, setGoadEnabled] = useState(true)
  const [layout, setLayout] = useState<RangeBuilderLayout>({})
  const [layoutRangeId, setLayoutRangeId] = useState<string | null>(null)
  const loadedRangeRef = useRef<string | null>(null)
  const appliedConfigRef = useRef<string | null>(null)
  const baselineRef = useRef<string | null>(null)
  const seenRangeRef = useRef<string | null>(null)
  const [docRangeId, setDocRangeId] = useState<string | null>(selectedRangeId ?? null)
  const [appliedRangeId, setAppliedRangeId] = useState<string | null>(null)
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutRef = useRef<RangeBuilderLayout>({})
  const layoutHydratedRef = useRef(false)
  const layoutOpsRef = useRef<LayoutOp[]>([])
  const depsRangeRef = useRef(selectedRangeId)
  if (depsRangeRef.current !== selectedRangeId) {
    depsRangeRef.current = selectedRangeId
    if (depsReady) setDepsReady(false)
  }
  if (docRangeId !== (selectedRangeId ?? null)) {
    setDocRangeId(selectedRangeId ?? null)
    setAppliedRangeId(null)
    setDoc(parseRangeDocument(""))
    setOriginalYaml("")
    setLayout({})
    setLayoutRangeId(null)
    setDeployStarted(false)
    setKindChoice("ludus")
    setGoadLabPick(null)
    setGoadExtPick([])
    setDepsReady(false)
    layoutHydratedRef.current = false
    layoutOpsRef.current = []
    layoutRef.current = {}
    loadedRangeRef.current = null
    appliedConfigRef.current = null
    baselineRef.current = null
    seenRangeRef.current = selectedRangeId ?? null
  }

  const { data: cachedConfig, isLoading: configLoading, isError: configError } = useQuery({
    queryKey: queryKeys.rangeConfig(scopeTag, selectedRangeId),
    queryFn: async () => {
      const id = selectedRangeId ?? ""
      const result = await new Promise<Awaited<ReturnType<typeof ludusApi.getRangeConfig>>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out loading this range")), 20_000)
        ludusApi.getRangeConfig(id).then(
          (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          (error) => {
            clearTimeout(timer)
            reject(error)
          },
        )
      })
      if (result.error) throw new Error(result.error)
      const raw = result.data as { result?: string } | string
      const yaml = typeof raw === "string" ? raw : (raw as { result?: string })?.result || ""
      return { rangeId: id, yaml }
    },
    enabled: !!selectedRangeId,
    staleTime: STALE.long,
    retry: false,
  })

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: queryKeys.templates(scopeTag),
    queryFn: async () => {
      const res = await ludusApi.listTemplates()
      if (res.error) throw new Error(res.error)
      return extractArray<TemplateObject>(res.data as unknown)
    },
    staleTime: STALE.long,
  })

  const { data: versionData } = useQuery({
    queryKey: queryKeys.version(scopeTag),
    queryFn: async () => {
      const res = await ludusApi.getVersion()
      return res.data ?? null
    },
    select: (d) => (d ? d.result || d.version || "" : ""),
    staleTime: STALE.long,
  })
  const ludusVersion = versionData ?? ""

  const { data: rangeStatus } = useQuery({
    queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId),
    queryFn: async () => {
      const rid = selectedRangeId?.trim()
      if (!rid) return null
      const result = await ludusApi.getRangeStatus(rid)
      if (result.error) {
        if (result.status === 400) {
          return queryClient.getQueryData<RangeObject>(queryKeys.rangeStatus(scopeTag, rid)) ?? null
        }
        throw new Error(typeof result.error === "string" ? result.error : "Failed to load range status")
      }
      return result.data ?? null
    },
    enabled: !!selectedRangeId,
    staleTime: STALE.realtime,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })

  const {
    data: blueprintRows = [],
    isLoading: installedBlueprintsLoading,
    isError: installedBlueprintsError,
  } = useQuery({
    queryKey: queryKeys.blueprints(scopeTag),
    queryFn: async () => {
      const res = await ludusApi.listBlueprints()
      if (res.error) throw new Error(res.error)
      return normalizeBlueprintList(res.data)
    },
    enabled: !!selectedRangeId,
    staleTime: STALE.long,
  })

  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources(scopeTag),
    queryFn: async () => {
      const res = await fetch("/api/sources")
      const json = (await res.json()) as {
        available?: boolean
        error?: string
        sources?: Array<{ sourceID?: string; id?: string; name?: string; url?: string; ref?: string }>
      }
      if (!res.ok && json.available !== false) throw new Error(json.error || "Failed to load Ludus sources")
      return {
        available: json.available !== false && res.ok,
        sources: json.sources ?? [],
      }
    },
    enabled: !!selectedRangeId,
    staleTime: STALE.long,
  })
  const loadedSources = useMemo(
    () => mapRegisteredSources(sourcesQueryRows(sourcesQuery.data)),
    [sourcesQuery.data],
  )
  const sourceBlueprintQueries = useQueries({
    queries: loadedSources.map((source) => ({
      queryKey: queryKeys.sourceBlueprints(scopeTag, source.id, source.ref),
      queryFn: () =>
        fetchSourceCatalog<{
          name?: string
          description?: string
          sourceBlueprintID?: string
          id?: string
        }>(source.id, "blueprints"),
      staleTime: STALE.long,
    })),
  })
  const sourceBlueprintsLoading =
    sourcesQuery.isLoading || sourceBlueprintQueries.some((query) => query.isLoading)
  const blueprintsLoading = installedBlueprintsLoading || sourceBlueprintsLoading
  const blueprintsError = sourcesQuery.isError || (installedBlueprintsError && loadedSources.length === 0)

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { goadEnabled?: boolean } | null) => {
        if (data && typeof data.goadEnabled === "boolean") setGoadEnabled(data.goadEnabled)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const rangeId = selectedRangeId ?? null
    const rangeChanged = seenRangeRef.current !== rangeId
    if (rangeChanged) {
      seenRangeRef.current = rangeId
      loadedRangeRef.current = null
      appliedConfigRef.current = null
      baselineRef.current = null
      layoutHydratedRef.current = false
      layoutOpsRef.current = []
      layoutRef.current = {}
      setDepsReady(false)
      setLayout({})
      setDoc(parseRangeDocument(""))
      setOriginalYaml("")
      setDeployStarted(false)
      setKindChoice("ludus")
      setGoadLabPick(null)
      setGoadExtPick([])
    }
    const cached = cachedConfig as unknown
    const yaml =
      typeof cached === "string"
        ? cached
        : cached != null &&
            typeof cached === "object" &&
            "rangeId" in cached &&
            (cached as { rangeId?: string }).rangeId === rangeId
          ? ((cached as { yaml?: string }).yaml ?? null)
          : null
    if (!rangeId || yaml == null) return
    const saved = canonicalRangeYaml(yaml)
    const draftKey = rangeBuilderDraftKey(scopeTag, rangeId)
    const draft = readRangeBuilderDraft(draftKey)
    // A draft is the previous file. A blueprint apply replaces that file, so the draft is not the diagram.
    if (draftAppliesToSaved(draft, saved) && draft) {
      if (
        loadedRangeRef.current === rangeId &&
        appliedConfigRef.current === draft.yaml &&
        baselineRef.current === saved
      ) {
        setAppliedRangeId(rangeId)
        return
      }
      setDoc(parseRangeDocument(draft.yaml))
      setOriginalYaml(saved)
      loadedRangeRef.current = rangeId
      appliedConfigRef.current = draft.yaml
      baselineRef.current = saved
      setAppliedRangeId(rangeId)
      return
    }
    if (draft) clearRangeBuilderDraft(draftKey)
    if (loadedRangeRef.current === rangeId && baselineRef.current === saved) {
      setAppliedRangeId(rangeId)
      return
    }
    setDoc(parseRangeDocument(yaml))
    setOriginalYaml(saved)
    loadedRangeRef.current = rangeId
    appliedConfigRef.current = saved
    baselineRef.current = saved
    setAppliedRangeId(rangeId)
  }, [cachedConfig, scopeTag, selectedRangeId])

  const persistLayout = useCallback((rangeId: string, next: RangeBuilderLayout) => {
    if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current)
    layoutSaveTimer.current = setTimeout(() => {
      void fetch("/api/range/builder-layout", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rangeId, layout: next }),
      }).catch(() => {})
    }, 600)
  }, [])

  useEffect(() => {
    if (!selectedRangeId) return
    const rangeId = selectedRangeId
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const load = () => {
      fetch(`/api/range/builder-layout?rangeId=${encodeURIComponent(rangeId)}`, {
        credentials: "include",
      })
        .then(async (r) => {
          if (!r.ok) return r.status >= 500 ? null : false
          return (await r.json()) as { layout?: RangeBuilderLayout }
        })
        .then((d) => {
          if (cancelled) return
          if (d === false) {
            setLayoutRangeId(rangeId)
            return
          }
          if (!d) {
            retryTimer = setTimeout(load, 1000)
            return
          }
          const fetched = d.layout ?? {}
          const ops = layoutOpsRef.current
          layoutOpsRef.current = []
          const merged = reduceLayout(fetched, ops)
          layoutHydratedRef.current = true
          layoutRef.current = merged
          setLayout(merged)
          setLayoutRangeId(rangeId)
          if (ops.length > 0) persistLayout(rangeId, merged)
        })
        .catch(() => {
          if (!cancelled) retryTimer = setTimeout(load, 1000)
        })
    }

    load()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [persistLayout, selectedRangeId])

  const graph = useMemo(() => projectGraph(doc), [doc])
  const configYaml = useMemo(() => serializeRangeDocument(doc), [doc])
  const depsConfigRef = useRef(configYaml)
  if (depsConfigRef.current !== configYaml) {
    depsConfigRef.current = configYaml
    if (depsReady) setDepsReady(false)
  }

  const templates = useMemo(() => templateRows(templatesData), [templatesData])
  const builtNames = useMemo(() => new Set(templates.filter((t) => t.built).map((t) => t.name)), [templates])
  const allNames = useMemo(() => new Set(templates.map((t) => t.name)), [templates])
  const builtTemplates = useMemo(() => templates.filter((t) => t.built), [templates])

  const rangeMeta = ranges.find((r) => r.rangeID === selectedRangeId)
  const rangeNumber = typeof rangeMeta?.rangeNumber === "number" ? rangeMeta.rangeNumber : null
  const findings = useMemo(
    () => validateGraph(graph, builtNames, rangeNumber),
    [graph, builtNames, rangeNumber],
  )
  const hasErrors = hasBlockingFindings(findings)
  const rangeState = (rangeStatus?.rangeState ?? "").toString().toUpperCase()
  const deployBusy = deploying || rangeState === "DEPLOYING" || rangeState === "WAITING"
  const testingEnabled = rangeStatus?.testingEnabled === true
  const deployBlockedByTesting = testingEnabled && !forceLudus
  const routerDetails = useMemo((): RouterDetails => {
    const resolution = resolveRequiredRouterTemplateFromConfig({
      ludusVersion,
      configYaml,
      registeredTemplates: allNames,
      pinnedTemplate: graph.router.template,
    })
    const vmName =
      graph.router.vmName ||
      (selectedRangeId ? ludusRouterVmNameForTemplate(selectedRangeId, resolution.template) : resolution.template)
    const liveVms = rangeStatus?.VMs ?? rangeStatus?.vms ?? []
    const liveVm =
      liveVms.find((vm) => vm.name === vmName) ??
      liveVms.find((vm) => vm.name.includes("-router-")) ??
      null
    return {
      template: resolution.template,
      built: builtNames.has(resolution.template),
      vmName,
      hostname: graph.router.hostname,
      ramGb: graph.router.ramGb,
      cpus: graph.router.cpus,
      live: liveVm
        ? {
            name: liveVm.name,
            ip: liveVm.ip,
            poweredOn: liveVm.poweredOn === true,
            proxmoxId: liveVm.proxmoxID,
          }
        : null,
      gateways: graph.vlans.map((vlan) => ({
        vlan: vlan.vlan,
        address: rangeNumber != null ? `10.${rangeNumber}.${vlan.vlan}.254` : null,
      })),
    }
  }, [allNames, builtNames, configYaml, graph.router, graph.vlans, ludusVersion, rangeNumber, rangeStatus, selectedRangeId])

  const reloadConfig = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.rangeConfig(scopeTag, selectedRangeId) })
  }, [queryClient, scopeTag, selectedRangeId])

  const { impersonationHeaders } = useImpersonation()
  const goadState = useBuilderGoad({
    rangeId: selectedRangeId,
    builtNames,
    allNames,
    ludusVersion,
    configYaml,
    onReload: reloadConfig,
  })
  const isGoad = goadState.context != null
  const goadLab = goadState.instance?.lab ?? ""
  // Installed extensions only. Pending ones are already in this payload, and a new
  // query key would blank the canvas behind the loading overlay.
  const goadExtensions = [...(goadState.instance?.extensions ?? [])].sort().join(",")
  // A selected lab is not an instance yet. Preview its machines without writing range-config.
  const previewLab =
    builderSurface(rangeStatus) === "composer" && !isGoad && kindChoice === "goad" ? goadLabPick : null
  const previewExtensionKey = goadExtPick.join(",")
  const domainMapQuery = useQuery({
    queryKey: queryKeys.goadDomainMap(scopeTag, goadLab, goadExtensions),
    enabled: goadLab.length > 0,
    staleTime: STALE.long,
    queryFn: async (): Promise<GoadDirectory> => {
      const params = new URLSearchParams({ lab: goadLab, extensions: goadExtensions })
      const res = await fetch(`/api/goad/domain-map?${params}`, { headers: impersonationHeaders() })
      if (!res.ok) throw new Error("Could not read the GOAD domain map")
      return res.json() as Promise<GoadDirectory>
    },
  })
  const previewMapQuery = useQuery({
    queryKey: queryKeys.goadDomainMap(scopeTag, previewLab ?? "", previewExtensionKey),
    enabled: !!previewLab,
    staleTime: STALE.long,
    queryFn: async (): Promise<GoadDirectory> => {
      const params = new URLSearchParams({ lab: previewLab ?? "", extensions: previewExtensionKey })
      const res = await fetch(`/api/goad/domain-map?${params}`, { headers: impersonationHeaders() })
      if (!res.ok) throw new Error("Could not read the GOAD domain map")
      return res.json() as Promise<GoadDirectory>
    },
  })
  const previewConfigQuery = useQuery({
    queryKey: queryKeys.goadBuilderPreview(scopeTag, selectedRangeId ?? "", previewLab ?? "", previewExtensionKey),
    enabled: !!previewLab && !!selectedRangeId,
    staleTime: STALE.long,
    queryFn: async (): Promise<string> => {
      const res = await fetch("/api/goad/preview-config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...impersonationHeaders() },
        body: JSON.stringify({
          lab: previewLab,
          extensions: previewExtensionKey ? previewExtensionKey.split(",") : [],
          rangeId: selectedRangeId,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { yaml?: string; error?: string }
      if (!res.ok) throw new Error(data.error || "Could not preview this GOAD lab")
      return data.yaml ?? ""
    },
  })
  const needsDomainGuess = goadLab.length === 0 && graph.vms.some((vm) => vm.os === "windows" && !vm.domainFqdn)
  const domainCatalogQuery = useQuery({
    queryKey: queryKeys.goadDomainCatalog(scopeTag),
    enabled: needsDomainGuess,
    staleTime: STALE.long,
    queryFn: async (): Promise<{ labs: NamedGoadDirectory[]; extensions: NamedGoadDirectory[] }> => {
      const res = await fetch("/api/goad/domain-map?discover=1", { headers: impersonationHeaders() })
      if (!res.ok) throw new Error("Could not read GOAD lab domains")
      return res.json() as Promise<{ labs: NamedGoadDirectory[]; extensions: NamedGoadDirectory[] }>
    },
  })
  const goadDirectory = useMemo(() => {
    if (
      goadLab.length > 0 &&
      !domainMapQuery.isLoading &&
      domainMapQuery.data &&
      domainMapQuery.data.hosts.length > 0
    ) {
      return domainMapQuery.data
    }
    if (!domainCatalogQuery.data) return null
    return pickGoadDirectory(graph.vms, selectedRangeId ?? "", domainCatalogQuery.data)
  }, [domainCatalogQuery.data, domainMapQuery.data, domainMapQuery.isLoading, goadLab, graph.vms, selectedRangeId])
  const stagedExtensions = useMemo(() => {
    const pending = new Set(goadState.pendingExtensions)
    const planned = (goadDirectory?.vms ?? []).filter((vm) => pending.has(vm.extension))
    return addPlannedExtensionVms(graph, planned, selectedRangeId ?? "")
  }, [goadDirectory, goadState.pendingExtensions, graph, selectedRangeId])
  const pendingVmIds = useMemo(() => new Set(stagedExtensions.pendingVmIds), [stagedExtensions])
  const savedGraph = useMemo(
    () => overlayGoadDomains(stagedExtensions.graph, goadDirectory, selectedRangeId ?? ""),
    [goadDirectory, selectedRangeId, stagedExtensions.graph],
  )
  const previewSelection = previewLab ? `${previewLab}|${previewExtensionKey}` : null
  const previewSettled =
    previewSelection != null &&
    previewConfigQuery.isFetched &&
    !previewConfigQuery.isFetching &&
    previewMapQuery.isFetched &&
    !previewMapQuery.isFetching
  const previewGraph = useMemo(() => {
    if (!previewSettled || !previewConfigQuery.isSuccess) return null
    try {
      return graphForGoadPreview(previewConfigQuery.data ?? "", previewMapQuery.data ?? null, selectedRangeId ?? "")
    } catch {
      return null
    }
  }, [
    previewConfigQuery.data,
    previewConfigQuery.isSuccess,
    previewMapQuery.data,
    previewSettled,
    selectedRangeId,
  ])
  // Keep the last drawn lab on screen while the next lab or extension is fetched.
  // Falling back to the saved range flashes range-config.yml between those pictures.
  const previewHold = useRef<{ rangeId: string; key: string; graph: BuilderGraph } | null>(null)
  const previewRulesDocRef = useRef<{ key: string; doc: RangeDocument } | null>(null)
  if (previewHold.current && previewHold.current.rangeId !== (selectedRangeId ?? "")) previewHold.current = null
  if (previewLab && previewGraph && previewSelection && selectedRangeId) {
    previewHold.current = { rangeId: selectedRangeId, key: previewSelection, graph: previewGraph }
  }
  const heldPreview =
    previewLab && previewHold.current?.rangeId === selectedRangeId && !previewSettled
      ? previewHold.current.graph
      : null
  let ruleEdit = previewRuleEdit
  if (ruleEdit && ruleEdit.rangeId !== (selectedRangeId ?? "")) {
    ruleEdit = null
    setPreviewRuleEdit(null)
    previewRulesDocRef.current = null
  } else if (ruleEdit && previewSelection && ruleEdit.key !== previewSelection) {
    ruleEdit = null
    setPreviewRuleEdit(null)
    previewRulesDocRef.current = null
  }
  const heldRuleKey = previewHold.current?.rangeId === selectedRangeId ? previewHold.current.key : null
  const previewRules =
    ruleEdit && (ruleEdit.key === previewSelection || (!previewGraph && ruleEdit.key === heldRuleKey))
      ? ruleEdit.rules
      : null
  const showingGoadPreview = previewLab != null && previewGraph != null
  const shownPreview = previewGraph ?? heldPreview ?? EMPTY_PREVIEW_GRAPH
  const displayGraph = !previewLab
    ? savedGraph
    : previewRules
      ? { ...shownPreview, rules: previewRules }
      : shownPreview
  const previewFitToken = !previewLab
    ? "range"
    : `${displayGraph.vms.map((vm) => vm.id).join(",")}|${displayGraph.domains.map((domain) => domain.fqdn).join(",")}`
  const domainMapPending =
    goadLab.length > 0 && !domainMapQuery.isError && domainMapQuery.data == null
  const catalogPending = needsDomainGuess && !domainCatalogQuery.isError && domainCatalogQuery.data == null
  const diagramReady =
    goadState.lookupReady &&
    !domainMapPending &&
    !catalogPending &&
    layoutRangeId === selectedRangeId &&
    selectedRangeId != null
  // A linked lab has to wait for its own domain map. The name-only catalog
  // places DC01 and leaves WS01 under Not joined, and that must not be the picture we keep.
  const labMapReady =
    goadState.instance == null ||
    domainMapQuery.isError ||
    (domainMapQuery.data?.hosts.length ?? 0) > 0
  const revealedRangeRef = useRef<string | null>(null)
  if (diagramReady && labMapReady && selectedRangeId) revealedRangeRef.current = selectedRangeId
  const showDiagram =
    (diagramReady && labMapReady) ||
    (revealedRangeRef.current === selectedRangeId && labMapReady)
  const surface = builderSurface(rangeStatus)
  const kindLocked = surface === "viewer"
  const kind: BuilderKind = isGoad ? "goad" : kindLocked ? "ludus" : kindChoice
  const pickingGoadLab = kind === "goad" && !isGoad
  const goadCatalogQuery = useQuery({
    queryKey: queryKeys.goadCatalog(scopeTag),
    enabled: pickingGoadLab,
    staleTime: STALE.long,
    queryFn: async () => {
      const res = await fetch("/api/goad/catalog", {
        headers: impersonationHeaders(),
        credentials: "include",
      })
      const data = (await res.json()) as GoadCatalog & { error?: string; message?: string }
      if (!res.ok || data.error) throw new Error(data.error || "Could not load GOAD labs")
      if (!data.configured) throw new Error(data.message || "GOAD is not configured")
      return data
    },
  })
  const goadAnsibleQuery = useQuery({
    queryKey: queryKeys.goadBuilderAnsible(scopeTag),
    enabled: pickingGoadLab,
    staleTime: STALE.long,
    queryFn: async () => {
      const res = await ludusApi.listAnsible()
      if (res.error) throw new Error(res.error)
      return serializableAnsibleInstalled(parseAnsibleInstalledSets(res.data ?? []))
    },
  })
  const liveVms = useMemo((): LiveVmRow[] => {
    return (rangeStatus?.VMs ?? rangeStatus?.vms ?? []).map((vm) => {
      const ip = typeof vm.ip === "string" ? vm.ip.trim() : ""
      return {
        name: vm.name,
        poweredOn: vm.poweredOn === true,
        ip: !ip || ip.toLowerCase() === "null" ? "" : ip,
      }
    })
  }, [rangeStatus])
  const blueprints = useMemo((): BlueprintPaletteItem[] => {
    if (loadedSources.length > 0 && sourceBlueprintQueries.some((query) => query.isLoading)) return []
    return blueprintPaletteFromSources(
      loadedSources.map((source, index) => ({
        sourceId: source.id,
        sourceLabel: registeredSourceLabel(source),
        items: sourceCatalogItems(sourceBlueprintQueries[index]?.data),
      })),
      blueprintRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
      })),
    )
  }, [blueprintRows, loadedSources, sourceBlueprintQueries])

  const loadBlueprint = useCallback(
    (blueprint: BlueprintPaletteItem) => {
      if (!selectedRangeId || isGoad) return
      const needsInstall = Boolean(blueprint.sourceId && blueprint.installName && !blueprint.installedId)
      const sourceName = blueprint.sourceLabel ?? "its Ludus source"
      confirm(
        needsInstall
          ? `Install "${blueprint.name}" from ${sourceName} and replace this range configuration? Unsaved edits are discarded.`
          : `Replace this range configuration with blueprint "${blueprint.name}"? Unsaved edits are discarded.`,
        () => {
          void (async () => {
            setBlueprintBusyId(blueprint.id)
            try {
              let applyId = blueprint.installedId ?? blueprint.id
              if (needsInstall && blueprint.sourceId && blueprint.installName) {
                await postSourceInstall(blueprint.sourceId, { blueprints: [blueprint.installName] })
                const listed = await ludusApi.listBlueprints()
                if (!listed.error) {
                  const rows = normalizeBlueprintList(listed.data)
                  queryClient.setQueryData(queryKeys.blueprints(scopeTag), rows)
                  const found = rows.find((row) =>
                    installedBlueprintMatchesSource(row.id, blueprint.installName ?? "", blueprint.sourceId ?? ""),
                  )
                  if (found) applyId = found.id
                }
              }
              const res = await applyBlueprintToRange(applyId, selectedRangeId)
              if (!res.ok) {
                toast({ variant: "destructive", title: "Blueprint not loaded", description: res.error })
                return
              }
              const [rangeRes, blueprintRes] = await Promise.all([
                ludusApi.getRangeConfig(selectedRangeId),
                ludusApi.getBlueprintConfig(applyId),
              ])
              const rangeYaml = rangeRes.error ? "" : readLudusConfigYaml(rangeRes.data)
              const blueprintYaml = blueprintRes.error
                ? ""
                : substituteRangeIdInConfig(readLudusConfigYaml(blueprintRes.data), selectedRangeId)
              const picked = pickBlueprintCanvasYaml(baselineRef.current, rangeYaml, blueprintYaml)
              const canvasYaml = applyBlueprintNetwork(picked.yaml, blueprintYaml)
              let canvasCanonical = ""
              let rangeCanonical = ""
              try {
                canvasCanonical = canvasYaml.trim() ? canonicalRangeYaml(canvasYaml) : ""
                rangeCanonical = rangeYaml.trim() ? canonicalRangeYaml(rangeYaml) : ""
              } catch {
                canvasCanonical = canvasYaml.trim()
                rangeCanonical = rangeYaml.trim()
              }
              if (canvasYaml.trim() && canvasCanonical !== rangeCanonical) {
                const uploaded = await ludusApi.setRangeConfig(canvasYaml, selectedRangeId, true)
                if (uploaded.error) {
                  toast({ variant: "destructive", title: "Blueprint not loaded", description: uploaded.error })
                  return
                }
              }
              // Drop the draft before the config query updates, or the canvas keeps the old diagram.
              clearRangeBuilderDraft(rangeBuilderDraftKey(scopeTag, selectedRangeId))
              await queryClient.invalidateQueries({ queryKey: queryKeys.rangeConfig(scopeTag, selectedRangeId) })
              await queryClient.invalidateQueries({ queryKey: queryKeys.blueprints(scopeTag) })
              if (canvasCanonical) {
                queryClient.setQueryData(queryKeys.rangeConfig(scopeTag, selectedRangeId), {
                  rangeId: selectedRangeId,
                  yaml: canvasYaml,
                })
              }
              if (picked.source !== "unchanged") {
                layoutOpsRef.current = []
                layoutRef.current = {}
                layoutHydratedRef.current = true
                setLayout({})
                persistLayout(selectedRangeId, {})
              }
              setResetNonce((n) => n + 1)
              toast({ title: "Blueprint loaded", description: "Review the diagram, then deploy." })
            } catch (err) {
              toast({
                variant: "destructive",
                title: "Blueprint not loaded",
                description: err instanceof Error ? err.message : "Install failed",
              })
            } finally {
              setBlueprintBusyId(null)
            }
          })()
        },
      )
    },
    [confirm, isGoad, persistLayout, queryClient, scopeTag, selectedRangeId, toast],
  )

  const apply = useCallback((fn: (d: RangeDocument) => RangeDocument) => {
    setDoc((prev) => {
      const next = fn(prev)
      if (selectedRangeId && baselineRef.current != null) {
        rememberRangeBuilderDraft(
          rangeBuilderDraftKey(scopeTag, selectedRangeId),
          serializeRangeDocument(next),
          baselineRef.current,
        )
      }
      return next
    })
  }, [scopeTag, selectedRangeId])

  const applyLayoutOp = useCallback(
    (op: LayoutOp) => {
      if (!layoutHydratedRef.current) {
        layoutOpsRef.current = [...layoutOpsRef.current, op]
        const next = reduceLayout(layoutRef.current, [op])
        layoutRef.current = next
        setLayout(next)
        return
      }
      const next = reduceLayout(layoutRef.current, [op])
      layoutRef.current = next
      setLayout(next)
      if (selectedRangeId) persistLayout(selectedRangeId, next)
    },
    [persistLayout, selectedRangeId],
  )

  const onLayoutChange = useCallback(
    (patch: RangeBuilderLayout) => {
      applyLayoutOp({ kind: "patch", patch })
    },
    [applyLayoutOp],
  )

  const onLayoutRetarget = useCallback(
    (from: string, to: string) => {
      applyLayoutOp({ kind: "retarget", from, to })
    },
    [applyLayoutOp],
  )

  const onLayoutCompact = useCallback(
    (positions: RangeBuilderLayout) => {
      applyLayoutOp({ kind: "compact", positions })
    },
    [applyLayoutOp],
  )

  const onLayoutClearSizes = useCallback(
    (ids: string[]) => {
      applyLayoutOp({ kind: "clear-size", ids })
    },
    [applyLayoutOp],
  )

  const persistConfig = useCallback(async (): Promise<boolean> => {
    if (!selectedRangeId) return false
    if (loadedRangeRef.current !== selectedRangeId) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: "Range configuration has not finished loading.",
      })
      return false
    }
    const yaml = serializeRangeDocument(doc)
    if (!yaml.trim() || yaml.trim() === "{}") {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: "Refusing to upload an empty range configuration.",
      })
      return false
    }
    setSaving(true)
    try {
      const saved = await saveRangeBuilderConfig({
        rangeId: selectedRangeId,
        scopeTag,
        yaml,
        baseline: originalYaml,
        force: forceLudus,
        goadInstanceId: isGoad ? goadState.instanceId : null,
        queryClient,
      })
      if (!saved) return false
      setOriginalYaml(yaml)
      appliedConfigRef.current = yaml
      baselineRef.current = yaml
      loadedRangeRef.current = selectedRangeId
      return true
    } finally {
      setSaving(false)
    }
  }, [doc, forceLudus, isGoad, goadState.instanceId, originalYaml, queryClient, scopeTag, selectedRangeId, toast])

  const deployPendingExtensions = useCallback(async () => {
    const names = goadState.pendingExtensions
    if (names.length === 0 || (testingEnabled && !forceLudus)) return
    if (configYaml !== originalYaml) {
      const saved = await persistConfig()
      if (!saved) return
    }
    router.push(goadState.instanceId ? `/goad/${encodeURIComponent(goadState.instanceId)}` : "/goad")
    for (const name of names) {
      await goadState.installExtension(name)
    }
  }, [configYaml, forceLudus, goadState, originalYaml, persistConfig, router, testingEnabled])

  const doDeploy = useCallback(async () => {
    if (testingEnabled && !forceLudus) return
    const saved = await persistConfig()
    if (!saved || !selectedRangeId) return
    setDeploying(true)
    try {
      const tags = isGoad ? ["network"] : documentHasRoles(doc) ? undefined : undefined
      const res = await ludusApi.deployRange(tags, undefined, selectedRangeId, forceLudus)
      if (res.error) {
        toast({ variant: "destructive", title: "Deploy failed", description: res.error })
        return
      }
      setDeployStarted(true)
      toast({
        title: isGoad ? "Firewall deploy started" : "Deployment started",
        description: isGoad ? "The GOAD lab has the output." : "Range Logs has the output.",
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, selectedRangeId) })
      router.push(
        isGoad
          ? goadState.instanceId
            ? `/goad/${encodeURIComponent(goadState.instanceId)}`
            : "/goad"
          : "/logs",
      )
    } finally {
      setDeploying(false)
    }
  }, [persistConfig, selectedRangeId, isGoad, doc, forceLudus, goadState.instanceId, queryClient, router, scopeTag, testingEnabled, toast])

  const selectGoadLab = useCallback((name: string) => {
    setGoadLabPick(name)
    setGoadExtPick([])
  }, [])
  const toggleGoadExtension = useCallback((name: string) => {
    setGoadExtPick((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]))
  }, [])
  const applyPreviewRules = useCallback((fn: (d: RangeDocument) => RangeDocument) => {
    if (!previewSettled || !previewSelection || !selectedRangeId) return
    const yaml = previewConfigQuery.data ?? ""
    if (!yaml.trim()) return
    const docKey = `${selectedRangeId}|${previewSelection}`
    const base = previewRulesDocRef.current?.key === docKey
      ? previewRulesDocRef.current.doc
      : parseRangeDocument(yaml)
    const next = fn(base)
    const before = projectGraph(base)
    const after = projectGraph(next)
    const beforeIds = before.vms.map((vm) => vm.id).join("\0")
    const afterIds = after.vms.map((vm) => vm.id).join("\0")
    if (beforeIds !== afterIds || sameNetworkRules(before.rules, after.rules)) return
    previewRulesDocRef.current = { key: docKey, doc: setNetworkRules(base, after.rules) }
    setPreviewRuleEdit((current) => ({
      rangeId: selectedRangeId,
      key: previewSelection,
      rules: after.rules,
      base: current?.rangeId === selectedRangeId && current.key === previewSelection ? current.base : before.rules,
    }))
  }, [previewConfigQuery.data, previewSelection, previewSettled, selectedRangeId])
  const ignorePreviewLayout = useCallback((_patch: RangeBuilderLayout) => {}, [])
  const ignorePreviewRetarget = useCallback((_from: string, _to: string) => {}, [])
  const ignorePreviewCompact = useCallback((_positions: RangeBuilderLayout) => {}, [])
  const ignorePreviewClear = useCallback((_ids: string[]) => {}, [])
  const emptyPreviewLayout = useMemo<RangeBuilderLayout>(() => ({}), [])
  const { refetch: refetchGoadCatalog } = goadCatalogQuery
  const retryGoadCatalog = useCallback(() => {
    void refetchGoadCatalog()
  }, [refetchGoadCatalog])
  const ansibleInstalled = useMemo(
    () =>
      goadAnsibleQuery.isError
        ? { roles: new Set<string>(), collections: new Set<string>() }
        : coerceAnsibleInstalledSets(goadAnsibleQuery.data),
    [goadAnsibleQuery.data, goadAnsibleQuery.isError],
  )
  const { refetch: refetchGoadAnsible } = goadAnsibleQuery
  useEffect(() => {
    if (goadAnsibleQuery.data == null || ansibleInstalled) return
    void refetchGoadAnsible()
  }, [ansibleInstalled, goadAnsibleQuery.data, refetchGoadAnsible])
  const goadReadiness = useMemo((): GoadPickReadiness => ({
    builtNames,
    allNames,
    ludusVersion,
    templatesLoading,
    ansible: ansibleInstalled,
    ansibleLoading: pickingGoadLab && (goadAnsibleQuery.isLoading || ansibleInstalled == null),
  }), [allNames, ansibleInstalled, builtNames, goadAnsibleQuery.isLoading, ludusVersion, pickingGoadLab, templatesLoading])
  const pickedGoadLab = goadCatalogQuery.data?.labs.find((lab) => lab.name === goadLabPick) ?? null
  const goadDeployGate = goadPickCanDeploy({
    lab: pickedGoadLab,
    selectedExtensions: goadExtPick,
    extensions: goadCatalogQuery.data?.extensions ?? [],
    readiness: goadReadiness,
  })
  const goadDeployReason = !pickingGoadLab
    ? null
    : goadCatalogQuery.isLoading
      ? "GOAD labs are still loading."
      : goadCatalogQuery.isError
        ? "Could not load GOAD labs."
        : goadDeployGate.reason
  const goadPick = useMemo((): GoadLabPick | null => {
    if (!pickingGoadLab) return null
    return {
      labs: goadCatalogQuery.data?.labs ?? [],
      extensions: goadCatalogQuery.data?.extensions ?? [],
      loading: goadCatalogQuery.isLoading,
      error: goadCatalogQuery.isError
        ? goadCatalogQuery.error instanceof Error
          ? goadCatalogQuery.error.message
          : "Could not load GOAD labs"
        : null,
      selectedLab: goadLabPick,
      selectedExtensions: goadExtPick,
      readiness: goadReadiness,
      onSelectLab: selectGoadLab,
      onToggleExtension: toggleGoadExtension,
      onRetry: retryGoadCatalog,
    }
  }, [
    goadCatalogQuery.data,
    goadCatalogQuery.error,
    goadCatalogQuery.isError,
    goadCatalogQuery.isLoading,
    goadExtPick,
    goadLabPick,
    goadReadiness,
    pickingGoadLab,
    retryGoadCatalog,
    selectGoadLab,
    toggleGoadExtension,
  ])

  const openDeployApproval = useCallback((approval: {
    title: string
    note: string
    yaml: string
    confirmLabel: string
    run: () => void
  }) => {
    setDeployApproval(approval)
  }, [])

  const handleDeploy = useCallback(() => {
    if (deployBusy || (testingEnabled && !forceLudus)) return
    if (pickingGoadLab) {
      if (!selectedRangeId || !pickedGoadLab || goadDeployReason) return
      const previewYaml = previewConfigQuery.data ?? ""
      if (!previewSettled || !previewYaml.trim()) {
        toast({
          title: "The lab configuration is still loading",
          description: "Wait until the canvas finishes drawing, then deploy.",
        })
        return
      }
      const catalogExtensions = goadCatalogQuery.data?.extensions ?? []
      const names = goadExtPick.filter((name) => catalogExtensions.some((ext) => ext.name === name))
      const goadRules = previewRules ?? extractNetworkRules(previewYaml, { fileOrder: true })
      const yaml = mergeGoadPreviewWithNetworkRules(previewYaml, goadRules, null, { rulesAreComplete: true })
      const leftOut = configYaml !== originalYaml
        ? " Unsaved Ludus builder edits are left out of this configuration."
        : ""
      openDeployApproval({
        title: `Deploy ${pickedGoadLab.name}`,
        note: `This deploys the Ludus range, then applies the GOAD configuration.${leftOut}`,
        yaml,
        confirmLabel: "Deploy",
        run: () => {
          const handoff = writeGoadBuilderDeploy({
            rangeId: selectedRangeId,
            lab: pickedGoadLab.name,
            extensions: names,
            networkRules: goadRules,
            replacesConfig: true,
          })
          if (!handoff) {
            toast({
              variant: "destructive",
              title: "Could not start the GOAD deploy",
              description: "The lab choice could not be saved for the deployment page.",
            })
            return
          }
          router.push(`/goad/new?rangeId=${encodeURIComponent(selectedRangeId)}`)
        },
      })
      return
    }
    if (isGoad && goadState.pendingExtensions.length > 0) {
      const names = goadState.pendingExtensions.join(", ")
      openDeployApproval({
        title: `Install ${names}`,
        note: "Approve this configuration. Deploy saves it, then installs those extensions. The machines stay pending until that finishes.",
        yaml: configYaml,
        confirmLabel: "Deploy",
        run: () => { void deployPendingExtensions() },
      })
      return
    }
    openDeployApproval({
      title: isGoad ? "Deploy firewall rules" : "Deploy this range",
      note: isGoad
        ? "Approve this configuration. Deploy saves it and deploys the network tag. Lab VMs are unchanged."
        : "Approve this configuration. Deploy saves it and starts a full deploy.",
      yaml: configYaml,
      confirmLabel: "Deploy",
      run: () => { void doDeploy() },
    })
  }, [
    configYaml,
    deployBusy,
    deployPendingExtensions,
    doDeploy,
    forceLudus,
    goadCatalogQuery.data?.extensions,
    goadDeployReason,
    goadExtPick,
    goadState.pendingExtensions,
    isGoad,
    openDeployApproval,
    originalYaml,
    pickedGoadLab,
    pickingGoadLab,
    previewConfigQuery.data,
    previewRules,
    previewSettled,
    router,
    selectedRangeId,
    testingEnabled,
    toast,
  ])

  const handleReset = useCallback(() => {
    confirm("Discard unsaved changes and restore the last saved configuration?", () => {
      if (selectedRangeId) clearRangeBuilderDraft(rangeBuilderDraftKey(scopeTag, selectedRangeId))
      setDoc(parseRangeDocument(originalYaml))
      appliedConfigRef.current = originalYaml
      baselineRef.current = originalYaml
      goadState.clearPendingExtensions()
      setResetNonce((n) => n + 1)
    })
  }, [confirm, goadState, originalYaml, scopeTag, selectedRangeId])

  const yamlDirty = configYaml !== originalYaml
  const extensionPending = goadState.pendingExtensions.length > 0
  const isDirty = yamlDirty || extensionPending
  const saveInFlight = useSyncExternalStore(
    subscribeRangeBuilderSaves,
    () => rangeBuilderSaveInFlight(selectedRangeId),
    () => false,
  )
  const saveBusy = saving || saveInFlight

  useEffect(() => {
    if (!isDirty && !saveInFlight) return
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onLeave)
    return () => window.removeEventListener("beforeunload", onLeave)
  }, [isDirty, saveInFlight])

  if (!selectedRangeId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          {rangesLoading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading ranges…</p>
            </>
          ) : ranges.length === 0 ? (
            <>
              <AlertTriangle className="h-6 w-6 text-status-warning" />
              <p className="text-sm font-medium">No ranges available</p>
              <p className="text-xs text-muted-foreground">
                Deploy a new range first, or ask an admin to share one with you.
              </p>
            </>
          ) : (
            <>
              <Info className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Select a range from the sidebar to open it in the builder.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <Card className="flex-shrink-0">
        <CardContent className="space-y-2 p-3">
          <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />
          <DeployApprovalDialog
            open={deployApproval != null}
            title={deployApproval?.title ?? ""}
            note={deployApproval?.note ?? ""}
            yaml={deployApproval?.yaml ?? ""}
            confirmLabel={deployApproval?.confirmLabel ?? "Deploy"}
            onCancel={() => setDeployApproval(null)}
            onApprove={() => {
              const run = deployApproval?.run
              setDeployApproval(null)
              run?.()
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {(goadEnabled || isGoad) && (
              <div role="group" aria-label="Deployment type" className="flex rounded-md border border-border bg-muted/40 p-0.5">
                <button
                  type="button"
                  disabled={kindLocked || isGoad}
                  title={
                    kindLocked
                      ? isGoad
                        ? "This range was deployed as a GOAD lab"
                        : "This range was deployed as a Ludus range"
                      : isGoad
                        ? "This range is a GOAD lab"
                        : "Deploy this range with Ludus"
                  }
                  aria-pressed={kind === "ludus"}
                  onClick={() => setKindChoice("ludus")}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60",
                    kind === "ludus" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  Ludus
                </button>
                <button
                  type="button"
                  disabled={kindLocked}
                  title={kindLocked ? (isGoad ? "This range was deployed as a GOAD lab" : "This range was deployed as a Ludus range") : "Deploy this range as a GOAD lab"}
                  aria-pressed={kind === "goad"}
                  onClick={() => setKindChoice("goad")}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60",
                    kind === "goad" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  GOAD
                </button>
              </div>
            )}
            <Badge variant="secondary" className="text-xs">
              {surface === "viewer" ? "Range Viewer" : "Range Builder"}
            </Badge>
            <Button onClick={() => void persistConfig()} disabled={saveBusy || !yamlDirty || !!pendingAction} variant="outline">
              {saveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saveBusy ? "Saving…" : "Save Config"}
            </Button>
            <Button
              onClick={handleReset}
              disabled={!isDirty || saveBusy || deploying || !!pendingAction}
              variant="outline"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            <Button
              onClick={handleDeploy}
              disabled={
                pickingGoadLab
                  ? deployBusy || !!pendingAction || !!deployApproval || deployBlockedByTesting || goadDeployReason != null
                  : deployBusy || !!pendingAction || !!deployApproval || hasErrors || !depsReady || deployBlockedByTesting
              }
              title={
                deployBlockedByTesting
                  ? "Check Allow save and deploy while testing before deploying."
                  : goadDeployReason ?? undefined
              }
              variant={deployBusy || deployBlockedByTesting || (pickingGoadLab && goadDeployReason != null) ? "secondary" : "default"}
            >
              {deployBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {deployBusy ? "Deploying…" : extensionPending ? "Deploy extension" : isGoad ? "Deploy Firewall" : pickingGoadLab ? "Deploy GOAD" : "Deploy"}
            </Button>
            {(deployStarted || deployBusy) && (
              <Button asChild variant="outline">
                <Link href="/logs">Range Logs</Link>
              </Button>
            )}
            {isDirty && <Badge variant="warning" className="text-xs">Unsaved changes</Badge>}
            {hasErrors && (
              <Badge
                variant="destructive"
                className="text-xs gap-1"
                title={findings.filter((f) => f.level === "error").map((f) => f.message).join("\n")}
              >
                <ShieldAlert className="h-3 w-3" />
                {findings.filter((f) => f.level === "error").length} error(s)
              </Badge>
            )}
            {findings.some((f) => f.level === "warning") && (
              <Badge
                variant="warning"
                className="text-xs gap-1"
                title={findings.filter((f) => f.level === "warning").map((f) => f.message).join("\n")}
              >
                <AlertTriangle className="h-3 w-3" />
                {findings.filter((f) => f.level === "warning").length} warning(s)
              </Badge>
            )}
            {!hasErrors && !isDirty && (
              <span className="flex items-center gap-1 text-xs text-status-success">
                <CheckCircle2 className="h-4 w-4" /> Valid
              </span>
            )}
            <div className="flex-1" />
            <Link
              href="/range/config"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              <FileCode2 className="h-3.5 w-3.5" /> Open YAML
            </Link>
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1",
                deployBlockedByTesting
                  ? "border-status-warning bg-status-warning/15 ring-2 ring-status-warning"
                  : "border-border/60 bg-muted/30",
              )}
            >
              <Checkbox
                id="builder-force"
                checked={forceLudus}
                onCheckedChange={(v) => setForceLudus(v === true)}
                disabled={!!pendingAction || saveBusy}
              />
              <Label
                htmlFor="builder-force"
                title="Ludus blocks saving config and starting a deploy while the range is in testing mode unless this is checked. Does not turn testing mode off."
                className={cn(
                  "cursor-pointer text-xs font-normal",
                  deployBlockedByTesting ? "font-medium text-status-warning" : "text-muted-foreground",
                )}
              >
                Allow save and deploy while testing (--force)
                {deployBlockedByTesting ? " — required to deploy" : ""}
              </Label>
            </div>
          </div>
          {kind === "goad" && !isGoad && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {previewConfigQuery.isError
                  ? previewConfigQuery.error instanceof Error
                    ? previewConfigQuery.error.message
                    : "Could not draw this GOAD lab."
                  : previewLab && previewConfigQuery.isFetching && !showingGoadPreview
                    ? `Drawing ${previewLab}…`
                    : showingGoadPreview
                      ? `The canvas shows ${previewLab}${goadExtPick.length > 0 ? ` with ${goadExtPick.join(", ")}` : ""}. Switch to Ludus to restore this range. Deploy is what saves the lab.`
                      : "Pick a GOAD lab and any extensions on the left. The canvas draws that lab. Deploy starts it in this range and opens its deployment page."}
              </AlertDescription>
            </Alert>
          )}
          {isGoad && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                This range is a GOAD lab (instance <code className="text-primary">{goadState.instanceId}</code>).
                Lab VMs, domains, trusts, and VLANs are read-only — the next Provide rewrites them. A host
                joined with <code className="text-primary">commonwkstn</code> or <code className="text-primary">member_server</code> is
                drawn in that domain. Drag an extension onto the canvas to place it; it stays pending until you deploy.
                Firewall edits are preserved across Provide.
              </AlertDescription>
            </Alert>
          )}
          <BuilderAnsibleDepsPanel configYaml={configYaml} onReadyChange={setDepsReady} />
        </CardContent>
      </Card>

      <Card className="min-h-0 flex-1 overflow-hidden">
        <CardContent className="h-full p-0">
          {configError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-muted-foreground">Could not load this range.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.rangeConfig(scopeTag, selectedRangeId) })}
              >
                Retry
              </Button>
            </div>
          ) : appliedRangeId !== selectedRangeId || configLoading || !showDiagram ? (
            <LoadingRange />
          ) : (
            <RangeBuilderCanvasMount
              doc={doc}
              graph={displayGraph}
              apply={previewLab ? applyPreviewRules : apply}
              findings={previewLab ? [] : findings}
              rangeNumber={rangeNumber}
              builtTemplates={builtTemplates}
              allTemplates={templates}
              templatesLoading={templatesLoading}
              goad={goadState.context}
              locked={isGoad}
              layout={previewLab ? emptyPreviewLayout : layout}
              onLayoutChange={previewLab ? ignorePreviewLayout : onLayoutChange}
              onLayoutRetarget={previewLab ? ignorePreviewRetarget : onLayoutRetarget}
              onLayoutCompact={previewLab ? ignorePreviewCompact : onLayoutCompact}
              onLayoutClearSizes={previewLab ? ignorePreviewClear : onLayoutClearSizes}
              fitToken={previewFitToken}
              diagramCover={
                previewLab && !previewGraph && !heldPreview
                  ? previewConfigQuery.isError
                    ? previewConfigQuery.error instanceof Error
                      ? previewConfigQuery.error.message
                      : "Could not draw this GOAD lab."
                    : `Drawing ${previewLab}…`
                  : null
              }
              notify={toast}
              testingEnabled={testingEnabled}
              statusLoaded={rangeStatus != null}
              resetNonce={resetNonce}
              routerDetails={routerDetails}
              kind={kind}
              surface={surface}
              rangeId={selectedRangeId}
              liveVms={liveVms}
              pendingVmIds={pendingVmIds}
              blueprints={blueprints}
              blueprintsLoading={blueprintsLoading}
              blueprintsError={blueprintsError}
              blueprintBusyId={blueprintBusyId}
              hasLudusSources={loadedSources.length > 0}
              onLoadBlueprint={loadBlueprint}
              goadPick={goadPick}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
