"use client"

import { useState, useCallback, type Dispatch, type SetStateAction } from "react"
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"
import type { QueryClient } from "@tanstack/react-query"
import { ludusApi, postVmOperationAudit, pruneKnownHosts } from "@/lib/api"
import { matchingVmIdsForExtension } from "@/lib/extension-vm-match"
import {
  extensionIsProvisionOnly,
  goadSupportsProvisionOnlyExtensions,
} from "@/lib/goad-catalog-capabilities"
import { removeExtensionVmsFromRangeConfig } from "@/lib/network-rules"
import { clearRangeAborting } from "@/lib/range-aborting"
import { queryKeys } from "@/lib/query-keys"
import type { GoadCatalog, GoadExtensionDef, GoadInstance } from "@/lib/types"
import type { useToast } from "@/hooks/use-toast"

type ToastFn = ReturnType<typeof useToast>["toast"]
type ConfirmFn = (label: string, fn: () => void, key?: string) => void

export interface UseGoadInstanceActionHandlersParams {
  instance: GoadInstance | null
  instanceId: string
  catalog: GoadCatalog | null
  runAction: (action: string, goadArgs: string) => Promise<number | null>
  confirm: ConfirmFn
  toast: ToastFn
  impersonationHeaders: () => Record<string, string>
  scopeTag: string
  goadListQueryBucket: string
  queryClient: QueryClient
  router: AppRouterInstance
  taskId: string | null
  setInitializingRange: Dispatch<SetStateAction<boolean>>
  setReprovisioningExtension: Dispatch<SetStateAction<string | null>>
  setRemovingExtension: Dispatch<SetStateAction<string | null>>
  stop: () => void | Promise<void>
  stopRangeStreaming: () => void
  abortRangeUnified: (args: {
    rangeId: string
    goadInstanceId: string | null
    goadTaskId: string | null
  }) => Promise<{ success: boolean }>
  refreshRangeStateFromServer: (rangeId: string) => Promise<string | null>
  fetchInstances: () => void | Promise<void>
  refreshRanges: () => void | Promise<void>
}

export function useGoadInstanceActionHandlers(params: UseGoadInstanceActionHandlersParams) {
  const {
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
  } = params

  const extMap: Record<string, GoadExtensionDef> = Object.fromEntries(
    (catalog?.extensions ?? []).map((e) => [e.name, e]),
  )

  const handleStart = () =>
    confirm("Start all VMs?", () => runAction("start", `-i ${instanceId} -t start`))
  const handleStop = () =>
    confirm("Stop all VMs?", () => runAction("stop", `-i ${instanceId} -t stop`))

  const handleAbort = useCallback(async () => {
    try { await stop() } catch { /* stop() already swallows errors */ }
    stopRangeStreaming()

    const rangeId = instance?.ludusRangeId
    if (!rangeId) {
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
  ])

  const requestAbort = () =>
    confirm(
      "Abort the running deployment? This stops any in-flight GOAD task and asks Ludus to reset range state (with PocketBase fallback if needed).",
      handleAbort,
    )

  const ensureRangeIsolation = async (): Promise<string | null> => {
    if (instance?.ludusRangeId) return instance.ludusRangeId
    setInitializingRange(true)
    try {
      const res = await fetch(
        `/api/goad/instances/${encodeURIComponent(instanceId)}/init-range`,
        { method: "POST", headers: { "Content-Type": "application/json", ...impersonationHeaders() } },
      )
      const data = await res.json()
      if (!res.ok) {
        toast({ variant: "destructive", title: "Range creation failed", description: data.error || "Could not create a dedicated Ludus range for this instance." })
        return null
      }
      if (data.created) {
        toast({ title: "Dedicated range created", description: `Ludus range "${data.rangeId}" created for this instance.` })
      }
      fetchInstances()
      return data.rangeId as string
    } catch (err) {
      toast({ variant: "destructive", title: "Range creation failed", description: (err as Error).message })
      return null
    } finally {
      setInitializingRange(false)
    }
  }

  const handleProvide = () =>
    confirm("Provide (create Ludus infrastructure)?", async () => {
      const rangeId = await ensureRangeIsolation()
      if (!rangeId) return
      await runAction("provide", `--repl "use ${instanceId};update_instance_files;provide"`)
    })
  const handleProvisionLab = () =>
    confirm("Run full Ansible provisioning?", () =>
      runAction("provision-lab", `--repl "use ${instanceId};provision_lab"`),
    )

  const handleInstallProvideProvision = () =>
    confirm(
      [
        "Install — Provide + Provision lab?",
        "",
        "This runs two GOAD steps in one session:",
        "  1. Provide — create/update Ludus VMs and range infrastructure (no full lab Ansible yet).",
        "  2. Provision lab — run all Ansible playbooks for this lab.",
        "",
        "Use this for a full install when you would otherwise click Provide and then Provision Lab separately.",
      ].join("\n"),
      async () => {
        const rangeId = await ensureRangeIsolation()
        if (!rangeId) return
        await runAction(
          "install",
          `--repl "use ${instanceId};update_instance_files;provide;provision_lab"`,
        )
      },
    )

  const handleStatus = () => runAction("status", `-i ${instanceId} -t status`)

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
            },
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
      },
    )

  const handleInstallExtension = (name: string) => {
    const def = extMap[name]
    const noNewVms = def ? extensionIsProvisionOnly(def) : false
    const skipDeploy = noNewVms && goadSupportsProvisionOnlyExtensions(catalog)
    confirm(
      skipDeploy
        ? `Enable "${name}" and run Ansible only (no Ludus range deploy)?`
        : noNewVms
        ? `Install "${name}"? This extension adds no VMs, but GOAD at ${catalog?.goadPath ?? "your server"} does not support provision-only install_extension — a full Ludus range deploy will run.`
        : `Install "${name}"? Deploys new VMs and runs Ansible.`,
      () => runAction("install-extension", `--repl "use ${instanceId};install_extension ${name}"`),
      `ext-install:${name}`,
    )
  }

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

          const cleanupParts: string[] = []
          if (rmData.removedFromInstance) cleanupParts.push("instance.json")
          if ((rmData.deletedFiles?.length ?? 0) > 0) {
            cleanupParts.push(`${rmData.deletedFiles!.length} inventory file(s)`)
          }
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
        try {
          await fetch(`/api/goad/instances/${encodeURIComponent(instanceId)}/force-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...impersonationHeaders() },
            body: JSON.stringify({ ludusRangeId: instance?.ludusRangeId }),
          })
        } catch (err) {
          console.warn("[goad-actions] force-delete failed:", (err as Error).message)
        }
        await refreshRanges()
        void queryClient.invalidateQueries({ queryKey: queryKeys.goadInstancesList(scopeTag, goadListQueryBucket) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.goadInstancesList(scopeTag, "admin-global") })
        toast({ title: "Lab destroyed" })
        router.push("/goad")
      },
    )
  }

  const handleDeleteInstanceOnly = () =>
    confirm(
      `Remove GOAD instance "${instanceId}" from the server? The Ludus range and its VMs will not be deleted. You can deploy a new GOAD instance into this range later. This cannot be undone.`,
      async () => {
        try {
          const res = await fetch(`/api/goad/instances/${encodeURIComponent(instanceId)}/force-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...impersonationHeaders() },
            body: JSON.stringify({
              ludusRangeId: instance?.ludusRangeId,
              skipRangeDeletion: true,
            }),
          })
          const result = await res.json()
          await refreshRanges()
          void queryClient.invalidateQueries({ queryKey: queryKeys.goadInstancesList(scopeTag, goadListQueryBucket) })
          void queryClient.invalidateQueries({ queryKey: queryKeys.goadInstancesList(scopeTag, "admin-global") })
          if (result.errors?.length) {
            toast({
              title: "Remove instance completed with issues",
              description: result.errors.join("; "),
              variant: "destructive",
            })
          } else {
            toast({
              title: "GOAD instance removed",
              description: "Workspace deleted; Ludus range was left intact.",
            })
          }
          router.push("/goad")
        } catch (err) {
          toast({
            title: "Remove instance failed",
            description: (err as Error).message,
            variant: "destructive",
          })
        }
      },
    )

  return {
    syncingIps,
    handleStart,
    handleStop,
    handleAbort,
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
  }
}
