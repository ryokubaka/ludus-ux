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
 * Uses LUDUS_ROOT_API_KEY when valid; also the **same Ludus API key as the GOAD
 * SSH session** (logged-in user or impersonation) for GET /range/logs and GET /range
 * when the root key is missing or rejected — GOAD already proves that key works
 * against Ludus for this range. PocketBase `rangeState` patch still uses the root
 * key (PB superuser password) via `getToken()`.
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

function ludusRangeLogsResult(res: { data?: { result?: string }; status: number }): string | null {
  if (res.status < 200 || res.status >= 300) return null
  const raw = res.data?.result
  if (typeof raw !== "string" || !raw.length) return null
  return raw.length > LUDUS_RANGE_LOGS_MAX_CHARS ? raw.slice(-LUDUS_RANGE_LOGS_MAX_CHARS) : raw
}

function rangeStateFromLudusBody(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null
  const o = data as Record<string, unknown>
  if ("rangeState" in o && o.rangeState != null) {
    return String(o.rangeState).trim().toUpperCase()
  }
  if ("result" in o) return rangeStateFromLudusBody(o.result)
  return null
}

/** Tail of Ludus deploy text — same source as Range Logs (admin read for reconcile). */
async function readLudusRangeLogsForReconcile(rangeId: string, runtimeApiKey?: string): Promise<string | null> {
  const settings = getSettings()
  const rootKey = settings.rootApiKey?.trim()
  const runKey = runtimeApiKey?.trim()
  const path = `/range/logs?rangeID=${encodeURIComponent(rangeId)}`
  const optsBase = { timeout: 45_000 as const }

  if (!rootKey && !runKey) return null

  // No root key configured — only the GOAD session key can call Ludus.
  if (!rootKey && runKey) {
    const res = await ludusGet<{ result?: string }>(path, { ...optsBase, apiKey: runKey, useAdminEndpoint: false })
    const ok = ludusRangeLogsResult(res)
    if (ok != null) return ok
    diagThrottled(
      `logs-http-${rangeId}-session-only`,
      `GET /range/logs (:8080, session key only) failed for rangeId=${rangeId}: HTTP ${res.status} ${res.error ?? ""}`.trim(),
      120_000,
    )
    return null
  }

  const resAdmin = await ludusGet<{ result?: string }>(path, { ...optsBase, apiKey: rootKey!, useAdminEndpoint: true })
  const okAdmin = ludusRangeLogsResult(resAdmin)
  if (okAdmin != null) return okAdmin

  if (resAdmin.status === 401 || resAdmin.status === 403) {
    const resUser = await ludusGet<{ result?: string }>(path, { ...optsBase, apiKey: rootKey!, useAdminEndpoint: false })
    const okUser = ludusRangeLogsResult(resUser)
    if (okUser != null) return okUser

    if (runKey && runKey !== rootKey) {
      const resRun = await ludusGet<{ result?: string }>(path, { ...optsBase, apiKey: runKey, useAdminEndpoint: false })
      const okRun = ludusRangeLogsResult(resRun)
      if (okRun != null) return okRun
      if (resRun.status === 401 || resRun.status === 403) {
        diagThrottled(
          `ludus-range-logs-auth`,
          `GET /range/logs failed for rangeId=${rangeId}: root :8081 HTTP ${resAdmin.status}, root :8080 HTTP ${resUser.status}, GOAD session key :8080 HTTP ${resRun.status} ${(resRun.error ?? resUser.error ?? resAdmin.error ?? "").slice(0, 100)} — fix LUDUS_ROOT_API_KEY (Ludus root token) or confirm the Ludus user that started GOAD can read this range.`,
          3_600_000,
        )
        return null
      }
      diagThrottled(
        `logs-http-${rangeId}-runtime`,
        `GET /range/logs (GOAD session key, :8080) failed for rangeId=${rangeId}: HTTP ${resRun.status} ${resRun.error ?? ""}`.trim(),
        120_000,
      )
      return null
    }

    if (resUser.status === 401 || resUser.status === 403) {
      diagThrottled(
        `ludus-range-logs-root-key-rejected`,
        `GET /range/logs failed (admin HTTP ${resAdmin.status}, user port HTTP ${resUser.status}) for rangeId=${rangeId}: ${(resUser.error ?? resAdmin.error ?? "").slice(0, 120)} — LUDUS_ROOT_API_KEY rejected. No GOAD session Ludus key was available to retry (start deploy from LUX after upgrade).`,
        3_600_000,
      )
      return null
    }
    diagThrottled(
      `logs-http-${rangeId}-user`,
      `GET /range/logs (user :8080) failed for rangeId=${rangeId}: HTTP ${resUser.status} ${resUser.error ?? ""}`.trim(),
      120_000,
    )
    return null
  }

  diagThrottled(
    `logs-http-${rangeId}-admin`,
    `GET /range/logs (admin) failed for rangeId=${rangeId}: HTTP ${resAdmin.status} ${resAdmin.error ?? ""}`.trim(),
    120_000,
  )
  return null
}

async function readRangeStateForReconcile(rangeId: string, runtimeApiKey?: string): Promise<string | null> {
  const rootKey = getSettings().rootApiKey?.trim()
  const runKey = runtimeApiKey?.trim()
  const path = `/range?rangeID=${encodeURIComponent(rangeId)}`

  if (rootKey) {
    const res = await ludusRequest<unknown>(path, { method: "GET", apiKey: rootKey, useAdminEndpoint: true })
    if (res.status >= 200 && res.status < 300 && res.data != null) {
      const st = rangeStateFromLudusBody(res.data)
      if (st) return st
    }
  }
  if (runKey && runKey !== rootKey) {
    const res = await ludusRequest<unknown>(path, { method: "GET", apiKey: runKey, useAdminEndpoint: false })
    if (res.status >= 200 && res.status < 300 && res.data != null) {
      const st = rangeStateFromLudusBody(res.data)
      if (st) return st
    }
  }
  return null
}

export async function tryReconcileStuckDeploySnapshot(args: {
  taskId: string
  instanceId?: string
  status: string
  logText: string
  ludusApiKey?: string
}): Promise<boolean> {
  const { taskId, instanceId, status, logText, ludusApiKey } = args
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
    const sessionKey = ludusApiKey?.trim()
    if (!rootApiKey && !sessionKey) {
      diagThrottled(
        `task-${taskId}-no-keys`,
        `task ${taskId}: skip reconcile (set LUDUS_ROOT_API_KEY and/or run GOAD from LUX so a Ludus session API key is available)`,
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
      ludusBlock = await readLudusRangeLogsForReconcile(rid, sessionKey)
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

    const current = await readRangeStateForReconcile(rid, sessionKey)
    if (!current) {
      diagThrottled(
        `range-${rid}-no-state`,
        `rangeId=${rid}: skip reconcile (GET /range returned no rangeState with root and/or session Ludus key)`,
        120_000,
      )
      return false
    }
    if (current !== "DEPLOYING" && current !== "WAITING") return false

    lastAttemptAt.set(taskId, now)

    if (!rootApiKey) {
      diagThrottled(
        `range-${rid}-no-root-pb`,
        `rangeId=${rid}: skip PocketBase SUCCESS patch (LUDUS_ROOT_API_KEY unset — cannot auth PB superuser)`,
        300_000,
      )
      return false
    }

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
