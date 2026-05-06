/**
 * When GOAD's Ansible run has finished (PLAY RECAP, all hosts failed=0) but the
 * Ludus deploy goroutine never flips PocketBase `rangeState` out of
 * DEPLOYING/WAITING, GOAD's `provide` command keeps polling forever
 * ("deployment in progress (DEPLOYING)").
 *
 * This module detects that pattern in the streamed task log and patches
 * `rangeState` to SUCCESS in PocketBase — the same last-resort path as
 * `/api/range/abort` uses, but for success instead of ABORTED.
 *
 * Uses the configured Ludus root API key on the admin port to read the current
 * state before writing (avoids clobbering a real ERROR).
 */

import { ludusRequest } from "./ludus-client"
import { getSettings } from "./settings-store"
import { setPbRangeState } from "./pocketbase-client"
import { readGoadRangeId } from "./goad-ssh"
import { rootPasswordCredsIfSet } from "./root-ssh-auth"

const reconciledTaskIds = new Set<string>()
const lastAttemptAt = new Map<string, number>()

const THROTTLE_MS = 30_000
const MIN_LUDUS_POLL_SPAM = 12

function parseAnsibleRecapAllOk(log: string, recapIdx: number): boolean {
  const tail = log.slice(recapIdx)
  const lines = tail.split("\n").slice(0, 150)
  const hostLines: string[] = []
  for (const line of lines) {
    if (/^\s*PLAY\s+RECAP\b/i.test(line)) continue
    if (/^\s*$/.test(line) && hostLines.length > 0) break
    if (/^\s*\S.+\s+:\s+ok=\d+/.test(line) && /\bfailed\s*=\s*\d+/.test(line)) {
      hostLines.push(line)
    }
  }
  if (hostLines.length === 0) return false
  return hostLines.every((l) => /\bfailed\s*=\s*0\b/.test(l))
}

function countLudusDeployPollSpam(log: string, recapIdx: number): number {
  let n = 0
  for (const line of log.slice(recapIdx).split("\n")) {
    if (/deployment\s+in\s+progress/i.test(line) && /DEPLOYING/i.test(line)) n++
  }
  return n
}

async function readRangeStateAdmin(rangeId: string): Promise<string | null> {
  const settings = getSettings()
  const apiKey = settings.rootApiKey?.trim()
  if (!apiKey) return null
  const res = await ludusRequest<{ rangeState?: string }>(
    `/range?rangeID=${encodeURIComponent(rangeId)}`,
    { method: "GET", apiKey, useAdminEndpoint: true },
  )
  if (res.status < 200 || res.status >= 300) return null
  const raw = res.data?.rangeState
  return raw ? String(raw).trim().toUpperCase() : null
}

export async function tryReconcileStuckDeploySnapshot(args: {
  taskId: string
  instanceId?: string
  status: string
  logText: string
}): Promise<boolean> {
  const { taskId, instanceId, status, logText } = args
  if (status !== "running") return false
  if (reconciledTaskIds.has(taskId)) return false

  const now = Date.now()
  const prev = lastAttemptAt.get(taskId) ?? 0
  if (now - prev < THROTTLE_MS) return false

  const recapIdx = logText.lastIndexOf("PLAY RECAP")
  if (recapIdx < 0) return false
  if (!parseAnsibleRecapAllOk(logText, recapIdx)) return false
  if (countLudusDeployPollSpam(logText, recapIdx) < MIN_LUDUS_POLL_SPAM) return false
  if (!instanceId) return false

  lastAttemptAt.set(taskId, now)

  try {
    const settings = getSettings()
    const rootCreds = rootPasswordCredsIfSet(settings)
    const rangeId = await readGoadRangeId(instanceId, rootCreds)
    if (!rangeId?.trim()) return false

    const current = await readRangeStateAdmin(rangeId.trim())
    if (!current) return false
    if (current !== "DEPLOYING" && current !== "WAITING") return false

    const err = await setPbRangeState(rangeId.trim(), "SUCCESS")
    if (err) {
      console.warn(`[goad-ludus-reconcile] PocketBase SUCCESS patch failed for ${rangeId}: ${err}`)
      return false
    }
    reconciledTaskIds.add(taskId)
    console.info(
      `[goad-ludus-reconcile] Patched rangeState=SUCCESS for "${rangeId}" after Ansible OK + stuck Ludus poll (task ${taskId})`,
    )
    return true
  } catch (e) {
    console.warn("[goad-ludus-reconcile]", e)
    return false
  }
}
