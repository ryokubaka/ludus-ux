/**
 * After a GOAD deploy-class SSH task completes successfully, consume any wizard
 * pending-network snapshot and apply it + trigger Ludus `network` tag deploy.
 * Runs in-process on the server so users do not need to keep the instance page open.
 */

import { getInstanceRangeLocal } from "@/lib/goad-instance-range-store"
import { getHandoffByTaskId } from "@/lib/goad-deploy-handoff-store"
import {
  setTaskHasNetworkRules,
  updateTaskPhase,
  type TaskStatus,
} from "@/lib/goad-task-store"
import { reconcilePbAfterFollowOnLudusDeploy } from "@/lib/goad-ludus-reconcile"
import { ludusRequest } from "@/lib/ludus-client"
import { getProxyLudusTimeoutMs } from "@/lib/proxy-ludus-timeout"
import { applyNetworkSection, networkSectionEqual } from "@/lib/network-rules"
import { insertLuxDeployTagRun, updateLuxDeployTagRunLudusLogId } from "@/lib/range-log-markers-store"
import { correlateLudusLogIdAfterRangeAction } from "@/lib/range-ludus-log-correlate"
import { filterLudusDeployTags } from "@/lib/ludus-deploy-tags"
import { getSettings } from "@/lib/settings-store"
import { LUDUS_WAIT_ABSOLUTE_MAX_MS, waitUntilLudusRangeNotDeploying } from "@/lib/wait-ludus-range-state"
import { waitForNetworkTagDeployCompletion } from "@/lib/wait-lux-network-tag-deploy"
import { readUnlinkPendingNetworkSnapshot } from "@/lib/goad-pending-network-fs"
import type { RangeObject } from "@/lib/types"

/** Same predicate as `isDeployActionCommand` in goad-instance-tab-utils (lib must not import components). */
function isDeployClassGoadCommand(command: string): boolean {
  return /;\s*(provide|install|install_extension|provision_lab)\b/.test(command)
}

function buildLudusUserUrl(ludusPath: string): string {
  const settings = getSettings()
  const baseUrl = settings.ludusUrl.replace(/\/$/, "").trim()
  const apiPath = ludusPath.startsWith("/api/v2") ? ludusPath : `/api/v2${ludusPath}`
  return `${baseUrl}${apiPath}`
}

async function putRangeConfigYaml(
  apiKey: string,
  yaml: string,
  rangeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ludusPath = `/range/config?rangeID=${encodeURIComponent(rangeId)}`
  const formData = new FormData()
  formData.append("file", new Blob([yaml], { type: "application/x-yaml" }), "range-config.yml")
  try {
    const res = await fetch(buildLudusUserUrl(ludusPath), {
      method: "PUT",
      headers: { "X-API-KEY": apiKey },
      body: formData,
      cache: "no-store",
    })
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runAfterGoadTaskCompleteIfNeeded(args: {
  taskId: string
  command: string
  exitCode: number
  status: TaskStatus
  instanceId?: string
  username?: string
  ludusApiKey?: string
}): Promise<void> {
  const { taskId, command, exitCode, status, instanceId, username, ludusApiKey } = args
  if (status !== "completed" || exitCode !== 0) return
  if (!instanceId) return
  if (!isDeployClassGoadCommand(command)) return

  // Prefer in-memory apiKey, fall back to the persisted handoff record so
  // the workflow survives a container restart between task start and completion.
  let key = ludusApiKey?.trim()
  let resolvedRangeId = getInstanceRangeLocal(instanceId)?.trim()

  if (!key || !resolvedRangeId) {
    const handoff = getHandoffByTaskId(taskId)
    if (handoff) {
      if (!key && handoff.networkRulesJson) {
        // We don't store the API key in the handoff (it's in the session cookie),
        // so if the in-memory key is gone we cannot proceed with Ludus calls.
        // The pending-network file is already on disk from the handoff POST —
        // it will be consumed whenever a valid key becomes available.
      }
      if (!resolvedRangeId) resolvedRangeId = handoff.rangeId?.trim()
    }
  }

  if (!key) return
  if (!resolvedRangeId) return
  const rangeId = resolvedRangeId

  // readUnlinkPendingNetworkSnapshot is a destructive read — it deletes the
  // snapshot file after reading it. This is intentional: both this server
  // workflow and the [id] page wizard effect can race to consume the same
  // snapshot. The first caller wins; the second gets null and is a no-op.
  // Never call putRangeConfigYaml with a snapshot that was already applied.
  const snapshot = readUnlinkPendingNetworkSnapshot(instanceId)
  if (!snapshot) return

  setTaskHasNetworkRules(taskId, true)
  updateTaskPhase(taskId, "network-deploy")

  try {
    const cfg = await ludusRequest<{ result: string }>(
      `/range/config?rangeID=${encodeURIComponent(rangeId)}`,
      { apiKey: key, timeout: getProxyLudusTimeoutMs("/range/config", "GET") },
    )
    const yaml = cfg.data?.result
    if (yaml && !networkSectionEqual(yaml, snapshot)) {
      const merged = applyNetworkSection(yaml, snapshot)
      const put = await putRangeConfigYaml(key, merged, rangeId)
      if (!put.ok) {
        console.warn("[pending-network-workflow] setRangeConfig failed:", put.error)
      }
    }

    await waitUntilLudusRangeNotDeploying(
      () =>
        ludusRequest<RangeObject>(`/range?rangeID=${encodeURIComponent(rangeId)}`, {
          apiKey: key,
          timeout: 45_000,
        }),
      { pollMs: 5_000, absoluteMaxMs: LUDUS_WAIT_ABSOLUTE_MAX_MS },
    )

    for (let attempt = 0; attempt < 3; attempt++) {
      const tagRunAt = Date.now()
      const dep = await ludusRequest<unknown>(`/range/deploy?rangeID=${encodeURIComponent(rangeId)}`, {
        method: "POST",
        apiKey: key,
        body: { tags: "network" },
        timeout: getProxyLudusTimeoutMs("/range/deploy", "POST"),
      })
      if (!dep.error) {
        const tags = filterLudusDeployTags(["network"])
        const tagsCsv = tags.join(",")
        const runId = insertLuxDeployTagRun({
          rangeId,
          username: username?.trim() || "unknown",
          tagsCsv,
          requestedAt: tagRunAt,
        })
        void (async () => {
          const ludusLogId = await correlateLudusLogIdAfterRangeAction({
            rangeId,
            apiKey: key,
            requestedAtMs: tagRunAt,
          })
          if (ludusLogId) updateLuxDeployTagRunLudusLogId(runId, ludusLogId)
        })()

        const nw = await waitForNetworkTagDeployCompletion({
          rangeId,
          requestedAtMs: tagRunAt,
          fetchHistory: async () => {
            const h = await ludusRequest<unknown>(
              `/range/logs/history?rangeID=${encodeURIComponent(rangeId)}`,
              { apiKey: key, timeout: 25_000 },
            )
            return { data: h.data, error: h.error, status: h.status }
          },
          fetchStatus: () =>
            ludusRequest<RangeObject>(`/range?rangeID=${encodeURIComponent(rangeId)}`, {
              apiKey: key,
              timeout: 45_000,
            }),
          pollMs: 5_000,
          absoluteMaxMs: LUDUS_WAIT_ABSOLUTE_MAX_MS,
        })
        if (!nw.ok) {
          console.warn("[pending-network-workflow] network tag wait:", nw.via, nw.detail)
        }
        await reconcilePbAfterFollowOnLudusDeploy(rangeId, key)
        break
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
    }
  } catch (err) {
    console.error("[pending-network-workflow] error:", err)
  } finally {
    updateTaskPhase(taskId, null)
  }
}
