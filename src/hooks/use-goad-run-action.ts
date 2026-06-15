"use client"

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { ludusApi } from "@/lib/api"
import { registerLuxDeployTagRun } from "@/lib/register-lux-deploy-tag-run"
import { goadChainDebug } from "@/lib/goad-chain-debug"
import {
  extractNetworkSection,
  applyNetworkSection,
  networkSnapshotNeedsRedeploy,
  networkSectionEqual,
  type NetworkSnapshot,
} from "@/lib/network-rules"
import { LUDUS_WAIT_ABSOLUTE_MAX_MS, waitUntilLudusRangeNotDeploying } from "@/lib/wait-ludus-range-state"
import { waitForNetworkTagDeployCompletion } from "@/lib/wait-lux-network-tag-deploy"
import { queryKeys } from "@/lib/query-keys"
import {
  RANGE_YAML_TOUCHING_ACTIONS,
  DEPLOY_TAB_ACTIONS,
  TERMINAL_TAB_ACTIONS,
} from "@/components/goad/goad-instance-tab-utils"
import type { GoadPostProcessingStep } from "@/components/goad/goad-instance-tabs/types"
import type { GoadInstance } from "@/lib/types"
import type { useToast } from "@/hooks/use-toast"

type ToastFn = ReturnType<typeof useToast>["toast"]

export interface UseGoadRunActionParams {
  instance: GoadInstance | null
  instanceId: string
  impersonation: { username: string } | null
  impersonationHeaders: () => Record<string, string>
  scopeTag: string
  queryClient: QueryClient
  taskIdRef: MutableRefObject<string | null>
  postProcessingRef: MutableRefObject<boolean>
  setCurrentAction: Dispatch<SetStateAction<string | null>>
  setActiveTab: Dispatch<SetStateAction<string>>
  setPostProcessingStep: Dispatch<SetStateAction<GoadPostProcessingStep>>
  clear: () => void
  clearRangeLogs: () => void
  startRangeStreaming: (
    rangeId: string,
    options?: { snapshotStart?: boolean; deployElapsedAnchorMs?: number },
  ) => void
  run: (
    goadArgs: string,
    instanceId: string,
    impersonation?: { username: string },
    ludusRangeId?: string,
  ) => Promise<number | null>
  toast: ToastFn
  fetchInstances: () => void | Promise<void>
}

export function useGoadRunAction(params: UseGoadRunActionParams) {
  const {
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
  } = params

  const runAction = useCallback(
    async (action: string, goadArgs: string) => {
      setCurrentAction(action)
      clear()
      clearRangeLogs()
      const rangeIdForRestore = instance?.ludusRangeId
      let networkSnapshot: NetworkSnapshot | null = null
      if (RANGE_YAML_TOUCHING_ACTIONS.has(action) && rangeIdForRestore) {
        const cfg = await ludusApi.getRangeConfig(rangeIdForRestore)
        if (cfg.data?.result) {
          networkSnapshot = extractNetworkSection(cfg.data.result)
        }
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
      if (DEPLOY_TAB_ACTIONS.has(action)) {
        setActiveTab("deploy")
        if (instance?.ludusRangeId) {
          startRangeStreaming(instance.ludusRangeId, { snapshotStart: true })
        }
      } else if (TERMINAL_TAB_ACTIONS.has(action)) {
        setActiveTab("terminal")
      }
      const networkFollowup = networkSnapshotNeedsRedeploy(networkSnapshot)

      goadChainDebug("goad_action_start", {
        action,
        rangeId: instance?.ludusRangeId ?? null,
        instanceId,
        goadArgsHead: goadArgs.slice(0, 240),
      })
      const code = await run(
        goadArgs,
        instanceId,
        impersonation ?? undefined,
        instance?.ludusRangeId ?? undefined,
      )
      goadChainDebug("goad_action_exit", { action, exitCode: code, instanceId })
      setCurrentAction(null)
      const completedTaskId = taskIdRef.current
      try {
        if (networkSnapshot && rangeIdForRestore) {
          const after = await ludusApi.getRangeConfig(rangeIdForRestore)
          const yamlAfter = after.data?.result
          if (yamlAfter != null) {
            const networkAlreadyCorrect = networkSectionEqual(yamlAfter, networkSnapshot)
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

              if (rangeIdForRestore) {
                await waitUntilLudusRangeNotDeploying(() => ludusApi.getRangeStatus(rangeIdForRestore), {
                  pollMs: 5_000,
                  absoluteMaxMs: LUDUS_WAIT_ABSOLUTE_MAX_MS,
                })
              }

              let deployErr: string | null = null
              for (let attempt = 0; attempt < 3; attempt++) {
                const tagRunAt = Date.now()
                const dep = await ludusApi.deployRange(["network"], undefined, rangeIdForRestore)
                if (!dep.error) {
                  if (rangeIdForRestore) {
                    await registerLuxDeployTagRun(rangeIdForRestore, ["network"], tagRunAt)
                    const nw = await waitForNetworkTagDeployCompletion({
                      rangeId: rangeIdForRestore,
                      requestedAtMs: tagRunAt,
                      fetchHistory: () => ludusApi.getRangeLogHistory(rangeIdForRestore),
                      fetchStatus: () => ludusApi.getRangeStatus(rangeIdForRestore),
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
                      body: JSON.stringify({ rangeId: rangeIdForRestore }),
                    }).catch(() => {})
                  }
                  deployErr = null
                  break
                }
                deployErr = typeof dep.error === "string" ? dep.error : "Unknown error"
                if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
              }
              return deployErr
            }

            if (!networkAlreadyCorrect) {
              let putErr: string | null = null
              for (let attempt = 0; attempt < 3; attempt++) {
                let payload = merged
                if (attempt > 0) {
                  const fresh = await ludusApi.getRangeConfig(rangeIdForRestore)
                  const yamlNow = fresh.data?.result
                  if (yamlNow != null) {
                    const mergedNow = applyNetworkSection(yamlNow, networkSnapshot)
                    if (mergedNow === yamlNow) {
                      putErr = null
                      break
                    }
                    payload = mergedNow
                  }
                }
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
              } else if (networkFollowup) {
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
            } else if (networkAlreadyCorrect && networkFollowup) {
              const deployErr = await startNetworkTagDeploy()
              if (deployErr) {
                toast({
                  variant: "destructive",
                  title: "Firewall redeploy required",
                  description:
                    `Your network: block is already in range-config, but auto-deploy of the "network" tag failed (${deployErr}). Run Range Configuration → Deploy (tag "network") to apply router firewall rules.`,
                })
              } else if (code === 0) {
                toast({
                  title: "Firewall rules refreshed",
                  description:
                    "Range-config already had your network: block; a network-tag deploy was started so the router reapplies iptables. Watch Range Logs to confirm.",
                })
              } else {
                toast({
                  title: "Firewall redeploy running after GOAD error",
                  description:
                    `GOAD exited ${code}; your network: block was unchanged in Ludus, but a network-tag deploy was started to re-sync the router.`,
                })
              }
            }
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
    },
    [
      instance?.ludusRangeId,
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
    ],
  )

  return { runAction }
}
