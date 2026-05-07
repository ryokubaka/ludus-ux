/**
 * When GOAD's Ansible run has finished (PLAY RECAP, all hosts failed=0) but the
 * Ludus deploy goroutine never flips PocketBase `rangeState` out of
 * DEPLOYING/WAITING, GOAD's `provide` command keeps polling forever
 * ("deployment in progress (DEPLOYING)").
 *
 * PLAY RECAP often appears only in Ludus range logs while the GOAD REPL task log
 * shows only poll spam — the old logic required recap inside the GOAD buffer,
 * so reconcile never ran and provision_lab never started.
 *
 * This module patches `rangeState` to SUCCESS in PocketBase (same last-resort
 * idea as `/api/range/abort`, but for success).
 *
 * Uses the configured Ludus root API key on the admin port to read/write state.
 *
 * **Ludus product expectation:** the deploy controller should set PocketBase
 * `rangeState` to `SUCCESS` (or `ERROR`) when the deploy Ansible run finishes.
 * This module is a **client-side bridge** when that transition never happens.
 */

import { ludusGet, ludusRequest } from "./ludus-client"
import { getSettings } from "./settings-store"
import { setPbRangeState } from "./pocketbase-client"
import { readGoadRangeId } from "./goad-ssh"
import { rootPasswordCredsIfSet } from "./root-ssh-auth"
import { splitLeadingWallTimestamp } from "./log-line-timestamp"

const reconciledTaskIds = new Set<string>()
const lastAttemptAt = new Map<string, number>()
/** Throttle one-off diagnostic lines per task + reason (ms). */
const diagLastAt = new Map<string, number>()

const THROTTLE_MS = 30_000
/** Weighted score after last PLAY RECAP in the same buffer (GOAD log). */
const MIN_STUCK_SIGNAL_SCORE = 14
/** Standalone Ludus "deployment in progress" lines in the GOAD task log. */
const MIN_DEPLOY_POLL_LINES = 14
/** When recap exists only in Ludus `/range/logs`, fewer GOAD-only poll lines suffice. */
const MIN_DEPLOY_POLL_LINES_LUDUS_RECAP = 8
/**
 * Ludus `/range/logs` payloads can exceed multi‑MB; we cap memory but keep enough tail
 * that the final PLAY RECAP (after long Ansible) is still present for parsing.
 */
const LUDUS_RANGE_LOGS_MAX_CHARS = 3_000_000

function diagThrottled(key: string, msg: string, minIntervalMs: number) {
  const t = Date.now()
  if (t - (diagLastAt.get(key) ?? 0) < minIntervalMs) return
  diagLastAt.set(key, t)
  console.warn(`[goad-ludus-reconcile] ${msg}`)
}

function lineBodyForRecap(line: string): string {
  return splitLeadingWallTimestamp(line).body
}

function parseAnsibleRecapAllOk(log: string, recapIdx: number): boolean {
  const tail = log.slice(recapIdx)
  const lines = tail.split("\n").slice(0, 150)
  const hostLines: string[] = []
  for (const line of lines) {
    const body = lineBodyForRecap(line)
    if (/^[\s*]*PLAY\s+RECAP\b/i.test(body)) continue
    if (/^\s*$/.test(body) && hostLines.length > 0) break
    if (/^\s*\S.+\s+:\s*ok=\d+/.test(body) && /\bfailed\s*=\s*\d+/.test(body)) {
      hostLines.push(body)
    }
  }
  if (hostLines.length === 0) return false
  return hostLines.every((l) => /\bfailed\s*=\s*0\b/.test(l))
}

/** Lines after PLAY RECAP that indicate GOAD is stuck polling Ludus while rangeState stays DEPLOYING. */
function postRecapStuckSignalScore(log: string, recapIdx: number): number {
  let score = 0
  for (const line of log.slice(recapIdx).split("\n")) {
    const body = lineBodyForRecap(line)
    if (/deployment\s+in\s+progress/i.test(body) && /DEPLOYING/i.test(body)) {
      score += 2
    } else if (/using\s+api\s+key\s+from\s+env/i.test(body)) {
      score += 1
    }
  }
  return score
}

function countDeployingPollLinesFull(log: string): number {
  let n = 0
  for (const line of log.split("\n")) {
    const body = lineBodyForRecap(line)
    if (/deployment\s+in\s+progress/i.test(body) && /DEPLOYING/i.test(body)) n++
  }
  return n
}

/** Tail of Ludus deploy text — same source as Range Logs (admin read for reconcile). */
async function readLudusRangeLogsForReconcile(rangeId: string): Promise<string | null> {
  const settings = getSettings()
  const apiKey = settings.rootApiKey?.trim()
  if (!apiKey) return null
  const res = await ludusGet<{ result?: string }>(`/range/logs?rangeID=${encodeURIComponent(rangeId)}`, {
    apiKey,
    useAdminEndpoint: true,
    timeout: 45_000,
  })
  if (res.status < 200 || res.status >= 300) {
    diagThrottled(
      `logs-http-${rangeId}`,
      `GET /range/logs (admin) failed for rangeId=${rangeId}: HTTP ${res.status} ${res.error ?? ""}`.trim(),
      120_000,
    )
    return null
  }
  const raw = res.data?.result
  if (typeof raw !== "string" || !raw.length) return null
  return raw.length > LUDUS_RANGE_LOGS_MAX_CHARS ? raw.slice(-LUDUS_RANGE_LOGS_MAX_CHARS) : raw
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
  if (!instanceId) {
    diagThrottled(`task-${taskId}-no-instance`, `task ${taskId}: skip reconcile (no instanceId on task — rangeId cannot be resolved)`, 300_000)
    return false
  }

  try {
    const settings = getSettings()
    const rootApiKey = settings.rootApiKey?.trim()
    if (!rootApiKey) {
      diagThrottled(
        `task-${taskId}-no-root-key`,
        `task ${taskId}: skip reconcile (set Ludus root API key in LUX settings for admin /range + PocketBase patch)`,
        300_000,
      )
      return false
    }

    const rootCreds = rootPasswordCredsIfSet(settings)
    const rangeId = await readGoadRangeId(instanceId, rootCreds)
    if (!rangeId?.trim()) {
      diagThrottled(
        `task-${taskId}-no-rangeid`,
        `task ${taskId}: skip reconcile (readGoadRangeId empty for instanceId=${instanceId} — check .goad_range_id and root SSH)`,
        120_000,
      )
      return false
    }
    const rid = rangeId.trim()

    const recapGoad = logText.lastIndexOf("PLAY RECAP")
    const goadRecapOk = recapGoad >= 0 && parseAnsibleRecapAllOk(logText, recapGoad)

    let ludusBlock: string | null = null
    if (!goadRecapOk) {
      ludusBlock = await readLudusRangeLogsForReconcile(rid)
    }
    const recapLudus = ludusBlock ? ludusBlock.lastIndexOf("PLAY RECAP") : -1
    const ludusRecapOk =
      ludusBlock != null && recapLudus >= 0 && parseAnsibleRecapAllOk(ludusBlock, recapLudus)

    if (!goadRecapOk && !ludusRecapOk) return false

    const deployPollsFull = countDeployingPollLinesFull(logText)
    let stuck = false
    if (goadRecapOk) {
      stuck =
        postRecapStuckSignalScore(logText, recapGoad) >= MIN_STUCK_SIGNAL_SCORE ||
        deployPollsFull >= MIN_DEPLOY_POLL_LINES
    } else {
      stuck = ludusRecapOk && deployPollsFull >= MIN_DEPLOY_POLL_LINES_LUDUS_RECAP
    }

    if (!stuck) return false

    const current = await readRangeStateAdmin(rid)
    if (!current) {
      diagThrottled(`range-${rid}-no-state`, `rangeId=${rid}: skip reconcile (admin GET /range returned no rangeState)`, 120_000)
      return false
    }
    if (current !== "DEPLOYING" && current !== "WAITING") return false

    lastAttemptAt.set(taskId, now)

    const err = await setPbRangeState(rid, "SUCCESS")
    if (err) {
      console.warn(`[goad-ludus-reconcile] PocketBase SUCCESS patch failed for ${rangeId}: ${err}`)
      return false
    }
    reconciledTaskIds.add(taskId)
    console.info(
      `[goad-ludus-reconcile] Patched rangeState=SUCCESS for "${rangeId}" (task ${taskId}; goadRecap=${goadRecapOk} ludusRecap=${ludusRecapOk} deployPollLines=${deployPollsFull})`,
    )
    return true
  } catch (e) {
    console.warn("[goad-ludus-reconcile]", e)
    return false
  }
}
