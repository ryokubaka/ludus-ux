"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useConfirm } from "@/hooks/use-confirm"
import { useImpersonation } from "@/lib/session/impersonation-context"
import { useRange } from "@/lib/range/range-context"
import { useEffectiveScopeTag } from "@/lib/session/effective-scope-context"
import { useDeployLogContext } from "@/lib/logs/deploy-log-context"
import { useAbortRange } from "@/lib/ui/use-abort-range"
import { useGoadStream } from "@/components/goad/goad-terminal"
import { useGoadRunAction } from "@/hooks/use-goad-run-action"
import { useGoadInstanceActionHandlers } from "@/hooks/use-goad-instance-action-handlers"
import {
  extensionMissingAnsibleRoles,
  extensionAnsibleDepsReady,
  installGoadDependencies,
  requirementsFromExtensionRoleRefs,
  parseAnsibleInstalledSets,
  type AnsibleInstalledSets,
} from "@/lib/goad/goad-dependency-service"
import { findMissingFromInstalled } from "@/lib/ansible/ansible-requirements-service"
import { checkTemplates } from "@/components/goad/goad-instance-tab-utils"
import { ludusApi } from "@/lib/ui/api"
import type {
  GoadCatalog,
  GoadExtensionDef,
  GoadInstance,
  TemplateObject,
} from "@/lib/core/types"
import type { GoadPostProcessingStep } from "@/components/goad/goad-instance-tabs/types"
import type { GoadBuilderContext } from "./builder-types"

interface UseBuilderGoadArgs {
  rangeId: string | null
  builtNames: Set<string>
  allNames: Set<string>
  ludusVersion: string
  configYaml: string
  /** Called after an extension action completes so the canvas reloads range-config. */
  onReload: () => void
}

interface UseBuilderGoadResult {
  context: GoadBuilderContext | null
  instanceId: string | null
  instance: GoadInstance | null
  currentAction: string | null
  goadLines: string[]
  goadRunning: boolean
  rangeLogLines: string[]
  rangeStreaming: boolean
  /** Extensions placed on the canvas and not yet deployed. */
  pendingExtensions: string[]
  /** False until the GOAD lookup for this range has finished, including when the range is not a lab. */
  lookupReady: boolean
  installExtension: (name: string) => Promise<void>
  clearPendingExtensions: () => void
}

/**
 * Wires the existing GOAD run/action hooks so the range builder can install and
 * remove extensions through the same enable → provide → provision path the GOAD
 * instance page uses. Returns null context when the range is not GOAD-mapped.
 */
export function useBuilderGoad(args: UseBuilderGoadArgs): UseBuilderGoadResult {
  const { rangeId, builtNames, allNames, ludusVersion, configYaml, onReload } = args
  const { toast } = useToast()
  const router = useRouter()
  const queryClient = useQueryClient()
  const scopeTag = useEffectiveScopeTag()
  const { impersonation, impersonationHeaders } = useImpersonation()
  const { confirm } = useConfirm()
  const { refreshRanges, forgetRange } = useRange()
  const { abortRange: abortRangeUnified } = useAbortRange(scopeTag)
  const {
    lines: rangeLogLines,
    isStreaming: rangeStreaming,
    startStreaming: startRangeStreaming,
    stopStreaming: stopRangeStreaming,
    clearLogs: clearRangeLogs,
    refreshRangeStateFromServer,
  } = useDeployLogContext()

  const { lines: goadLines, isRunning: goadRunning, taskId, run, stop, clear } = useGoadStream({
    getExtraHeaders: impersonationHeaders,
  })

  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [instance, setInstance] = useState<GoadInstance | null>(null)
  const [instanceRangeId, setInstanceRangeId] = useState<string | null>(rangeId)
  const [settledRangeId, setSettledRangeId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<GoadCatalog | null>(null)
  const [ansibleInstalled, setAnsibleInstalled] = useState<AnsibleInstalledSets | null>(null)
  const [currentAction, setCurrentAction] = useState<string | null>(null)
  const [, setInitializingRange] = useState(false)
  const [, setReprovisioningExtension] = useState<string | null>(null)
  const [, setRemovingExtension] = useState<string | null>(null)
  const [, setPostProcessingStep] = useState<GoadPostProcessingStep>("idle")
  const rangeIdRef = useRef(rangeId)
  rangeIdRef.current = rangeId
  if (instanceRangeId !== rangeId) {
    setInstanceRangeId(rangeId)
    setInstanceId(null)
    setInstance(null)
    setCurrentAction(null)
    setSettledRangeId(null)
  }

  const taskIdRef = useRef<string | null>(null)
  taskIdRef.current = taskId
  const postProcessingRef = useRef(false)
  const suppressRangeLogsRef = useRef(false)

  // Resolve GOAD instance mapped to this range.
  const fetchInstances = useCallback(async () => {
    const requested = rangeId
    if (!requested) return
    try {
      const byRange = await fetch(`/api/goad/by-range?rangeId=${encodeURIComponent(requested)}`, {
        headers: impersonationHeaders(),
      })
      if (!byRange.ok) return
      const data = (await byRange.json().catch(() => ({}))) as { instanceId?: string | null }
      if (rangeIdRef.current !== requested) return
      const id = data.instanceId?.trim() || null
      setInstanceId(id)
      if (!id) {
        setInstance(null)
        return
      }
      const res = await fetch("/api/goad/instances", { headers: impersonationHeaders() })
      const body = await res.json().catch(() => ({}))
      if (rangeIdRef.current !== requested) return
      if (Array.isArray(body.instances)) {
        setInstance(body.instances.find((i: GoadInstance) => i.instanceId === id) ?? null)
      }
    } catch {
      /* non-fatal — range just stays non-GOAD in the builder */
    } finally {
      if (rangeIdRef.current === requested) setSettledRangeId(requested)
    }
  }, [rangeId, impersonationHeaders])

  useEffect(() => {
    void fetchInstances()
  }, [fetchInstances])

  useEffect(() => {
    let cancelled = false
    fetch("/api/goad/catalog", { method: "POST", credentials: "include" })
      .then((r) => r.json())
      .then((d: GoadCatalog) => { if (!cancelled && d.configured) setCatalog(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const refreshAnsible = useCallback(async () => {
    try {
      const res = await ludusApi.listAnsible()
      if (!res.error) setAnsibleInstalled(parseAnsibleInstalledSets(res.data ?? []))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (instanceId) void refreshAnsible()
  }, [instanceId, refreshAnsible])

  const reloadAfter = useCallback(async () => {
    await fetchInstances()
    onReload()
  }, [fetchInstances, onReload])

  const { runAction } = useGoadRunAction({
    instance,
    instanceId: instanceId ?? "",
    impersonation,
    impersonationHeaders,
    scopeTag,
    queryClient,
    taskIdRef,
    postProcessingRef,
    setCurrentAction,
    setActiveTab: () => {},
    setPostProcessingStep,
    clear,
    clearRangeLogs,
    startRangeStreaming,
    run,
    toast,
    fetchInstances: reloadAfter,
  })

  const { installExtension, handleRemoveExtension } = useGoadInstanceActionHandlers({
    instance,
    instanceId: instanceId ?? "",
    catalog,
    runAction,
    confirm,
    toast,
    impersonationHeaders,
    scopeTag,
    queryClient,
    router,
    taskId,
    setInitializingRange,
    setReprovisioningExtension,
    setRemovingExtension,
    stop,
    stopRangeStreaming,
    suppressRangeLogsRef,
    abortRangeUnified,
    refreshRangeStateFromServer,
    fetchInstances: reloadAfter,
    refreshRanges,
    forgetRange,
  })

  const extensionReady = useCallback(
    (ext: GoadExtensionDef) => {
      const tpl = checkTemplates(ext.requiredTemplates ?? [], builtNames, allNames, {
        ludusVersion,
        configYaml,
      })
      const missingAnsible = extensionMissingAnsibleRoles(ext, ansibleInstalled)
      const ansibleOk = extensionAnsibleDepsReady(ext, ansibleInstalled)
      return {
        ready: tpl.ready && ansibleOk,
        missingTemplates: [...tpl.missingUnbuilt, ...tpl.missingAbsent],
        missingAnsible,
      }
    },
    [builtNames, allNames, ludusVersion, configYaml, ansibleInstalled],
  )

  const onInstallDeps = useCallback(
    async (ext: GoadExtensionDef) => {
      if (!ansibleInstalled) return
      const required = requirementsFromExtensionRoleRefs(ext.requiredRoles ?? [])
      const installedItems = [
        ...[...ansibleInstalled.roles].map((name) => ({ name, type: "role" as const, version: "" })),
        ...[...ansibleInstalled.collections].map((name) => ({ name, type: "collection" as const, version: "" })),
      ]
      const missing = findMissingFromInstalled(installedItems, required)
      if (missing.length === 0) return
      const result = await installGoadDependencies(missing)
      await refreshAnsible()
      toast(
        result.failed.length > 0
          ? {
              variant: "destructive",
              title: "Some dependencies failed",
              description: result.failed.map((f) => `${f.name}: ${f.error}`).join("; "),
            }
          : { title: "Dependencies installed", description: `Ansible items for ${ext.name} are ready.` },
      )
    },
    [ansibleInstalled, refreshAnsible, toast],
  )

  const compatExtensions = (catalog?.extensions ?? []).filter((ext) => {
    if (!instance?.lab) return true
    return ext.compatibility.includes("*") || ext.compatibility.includes(instance.lab)
  })

  const [stagedExtensions, setStagedExtensions] = useState<string[]>([])
  useEffect(() => {
    setStagedExtensions([])
  }, [rangeId])
  const pendingExtensions = stagedExtensions.filter((name) => !(instance?.extensions ?? []).includes(name))

  const stageExtension = useCallback((name: string) => {
    setStagedExtensions((prev) => (prev.includes(name) ? prev : [...prev, name]))
  }, [])
  const unstageExtension = useCallback((name: string) => {
    setStagedExtensions((prev) => prev.filter((item) => item !== name))
  }, [])

  const context: GoadBuilderContext | null = instanceId
    ? {
        instanceId,
        labName: instance?.lab ?? null,
        extensions: compatExtensions,
        installed: new Set(instance?.extensions ?? []),
        pending: new Set(pendingExtensions),
        isRunning: goadRunning || currentAction != null,
        extensionReady,
        onInstall: stageExtension,
        onUnstage: unstageExtension,
        onRemove: handleRemoveExtension,
        onInstallDeps,
      }
    : null

  return {
    context,
    instanceId,
    instance,
    currentAction,
    goadLines,
    goadRunning,
    rangeLogLines,
    rangeStreaming,
    pendingExtensions,
    lookupReady: rangeId == null || settledRangeId === rangeId,
    installExtension,
    clearPendingExtensions: () => setStagedExtensions([]),
  }
}

export type { TemplateObject }
