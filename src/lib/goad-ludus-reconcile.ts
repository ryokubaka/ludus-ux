/**
 * When GOAD's Ansible run has finished (PLAY RECAP, all hosts failed=0) but the
 * Ludus deploy goroutine never flips PocketBase `rangeState` out of
 * DEPLOYING/WAITING, GOAD's `provide` command keeps polling forever
 * ("deploying...be patient" / legacy "deployment in progress (DEPLOYING)" spam).
 *
 * PLAY RECAP often appears only in Ludus range logs while the GOAD REPL task log
 * shows only poll spam — the old logic required recap inside the GOAD buffer,
 * so reconcile never ran and provision_lab never started.
 *
 * This module patches `rangeState` to SUCCESS in PocketBase (same last-resort
 * idea as `/api/range/abort`, but for success).
 *
 * Uses the Ludus root API key from LUX settings: **PocketBase first** for
 * `rangeState` (same token as PB admin — avoids admin-port-only 401 when the key
 * is valid for PB but misconfigured for `:8081`), then Ludus GET `/range` on the
 * admin API with a **fallback to the main Ludus API URL** on HTTP 401/403.
 * `/range/logs` prefers the **GOAD task owner's Ludus user API key** (same as the
 * log stream / session), then root key with admin→main fallback, then SSH to
 * `ansible.log`. `LUDUS_ROOT_API_KEY` remains the PocketBase admin password for
 * `setPbRangeState` / PB auth — it is not always a valid Ludus v2 `X-API-KEY`.
 *
 * **Ludus product expectation:** the deploy controller should set PocketBase
 * `rangeState` to `SUCCESS` (or `ERROR`) when the deploy Ansible run finishes.
 * This module is a **client-side bridge** when that transition never happens.
 */

import { ludusGet, ludusRequest } from "./ludus-client"
import { getSettings } from "./settings-store"
import { fetchPbRangeStatus, setPbRangeState } from "./pocketbase-client"
import { getHandoffByInstanceId, getHandoffByTaskId } from "./goad-deploy-handoff-store"
import { getInstanceRangeLocal } from "./goad-instance-range-store"
import { readGoadRangeId } from "./goad-ssh"
import { sshExec } from "./proxmox-ssh"
import { isRootProxmoxSshConfigured, rootPasswordCredsIfSet } from "./root-ssh-auth"
import { splitLeadingWallTimestamp } from "./log-line-timestamp"

const reconciledTaskIds = new Set<string>()
const lastAttemptAt = new Map<string, number>()
/** Throttle one-off diagnostic lines per task + reason (ms). */
const diagLastAt = new Map<string, number>()

const THROTTLE_MS = 30_000
/** Weighted score after last PLAY RECAP in the same buffer (GOAD log). */
const MIN_STUCK_SIGNAL_SCORE = 14
/** Standalone deploy-poll lines in the GOAD task log (string from GOAD ludus.py). */
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

export function parseAnsibleRecapAllOk(log: string, recapIdx: number): boolean {
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

/** True when GOAD/Ludus is polling while rangeState is still DEPLOYING (exact GOAD string from ludus.py). */
function isDeployPollLine(body: string): boolean {
  if (/deploying\.\.\.\s*be\s+patient/i.test(body)) return true
  if (/deployment\s+in\s+progress/i.test(body) && /DEPLOYING/i.test(body)) return true
  // Newer / alternate Ludus CLI status lines while PocketBase stays DEPLOYING.
  if (/\bstill\s+deploying\b/i.test(body)) return true
  if (/\bwaiting\b.*\b(deploy|deployment)\b/i.test(body) && /(DEPLOYING|WAITING)/i.test(body)) return true
  return false
}

/** Lines after PLAY RECAP that indicate GOAD is stuck polling Ludus while rangeState stays DEPLOYING. */
function postRecapStuckSignalScore(log: string, recapIdx: number): number {
  let score = 0
  for (const line of log.slice(recapIdx).split("\n")) {
    const body = lineBodyForRecap(line)
    if (isDeployPollLine(body)) {
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
    if (isDeployPollLine(body)) n++
  }
  return n
}

/**
 * Normalize Ludus GET /range?rangeID=… JSON (same shapes as /api/range/pb-status).
 * Some builds wrap the range in `{ "result": { … } }` or return an array.
 */
function ludusGetRangeObjectList(data: unknown): Record<string, unknown>[] {
  if (data == null) return []
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (typeof data === "object" && data !== null && "result" in data) {
    const inner = (data as { result?: unknown }).result
    if (Array.isArray(inner)) return inner as Record<string, unknown>[]
    if (inner && typeof inner === "object") return [inner as Record<string, unknown>]
  }
  if (typeof data === "object" && data !== null && "rangeID" in (data as object)) {
    return [data as Record<string, unknown>]
  }
  return []
}

function rangeStateFromRow(row: Record<string, unknown>): string | null {
  const raw = row.rangeState ?? row.RangeState
  if (typeof raw !== "string" || !raw.trim()) return null
  return raw.trim().toUpperCase()
}

/** Read rangeState from Ludus admin GET /range body for a given rangeID. */
function extractRangeStateFromLudusGetBody(data: unknown, wantRangeId: string): string | null {
  const want = wantRangeId.trim()
  const rows = ludusGetRangeObjectList(data)
  const byId = rows.find((r) => {
    const id = r.rangeID ?? r.RangeID
    return typeof id === "string" && id.trim() === want
  })
  const row = byId ?? (rows.length === 1 ? rows[0] : undefined)
  if (!row) return null
  return rangeStateFromRow(row)
}

/**
 * `rangeState` for reconcile: PocketBase first (works when Ludus admin HTTP rejects
 * the key but PB auth still works), then Ludus GET `/range` admin → main URL on 401/403.
 */
async function readRangeStateForReconcile(rangeId: string): Promise<string | null> {
  const rid = rangeId.trim()

  const pb = await fetchPbRangeStatus(rid)
  if (pb?.rangeState) {
    const rs = String(pb.rangeState).trim().toUpperCase()
    if (rs) return rs
  }

  const settings = getSettings()
  const apiKey = settings.rootApiKey?.trim()
  if (!apiKey) return null

  const path = `/range?rangeID=${encodeURIComponent(rid)}`
  let res = await ludusRequest<unknown>(path, { method: "GET", apiKey, useAdminEndpoint: true })
  if ((res.status === 401 || res.status === 403) && settings.ludusUrl?.trim()) {
    diagThrottled(
      `range-state-fallback-${rid}`,
      `GET /range (admin) HTTP ${res.status} — retrying on main Ludus API (same key)`,
      600_000,
    )
    res = await ludusRequest<unknown>(path, { method: "GET", apiKey, useAdminEndpoint: false })
  }
  if (res.status >= 200 && res.status < 300 && res.data !== undefined) {
    return extractRangeStateFromLudusGetBody(res.data, rid)
  }
  return null
}

/** Same path as `api/logs/stream` readGoadLog — Ludus v2 range deploy log on host. */
function capLudusLogTail(raw: string): string {
  const t = raw.trimEnd()
  return t.length > LUDUS_RANGE_LOGS_MAX_CHARS ? t.slice(-LUDUS_RANGE_LOGS_MAX_CHARS) : t
}

/** Root SSH to Ludus host; avoids Ludus HTTP when `/range/logs` rejects root key. */
async function readLudusAnsibleLogViaSsh(rangeId: string): Promise<string | null> {
  const rid = rangeId.trim()
  if (!/^[\w.-]+$/.test(rid)) return null
  const settings = getSettings()
  if (!settings.sshHost?.trim() || !isRootProxmoxSshConfigured(settings)) return null
  const logPath = `/opt/ludus/ranges/${rid}/ansible.log`
  try {
    const content = await sshExec(
      settings.sshHost,
      settings.sshPort,
      settings.proxmoxSshUser || "root",
      settings.proxmoxSshPassword || "",
      `cat "${logPath}" 2>/dev/null || true`,
    )
    if (!content.trim()) return null
    return capLudusLogTail(content)
  } catch (e) {
    diagThrottled(
      `logs-ssh-${rid}`,
      `SSH read ansible.log failed for rangeId=${rid}: ${e instanceof Error ? e.message : String(e)}`,
      120_000,
    )
    return null
  }
}

function ludusAnsibleLogPath(rangeId: string): string | null {
  const rid = rangeId.trim()
  if (!/^[\w.-]+$/.test(rid)) return null
  return `/opt/ludus/ranges/${rid}/ansible.log`
}

/** ansible.log mtime on Ludus host (ms epoch) — anchor history timestamps, not browser refresh time. */
export async function readLudusAnsibleLogMtimeMs(rangeId: string): Promise<number | null> {
  const logPath = ludusAnsibleLogPath(rangeId)
  if (!logPath) return null
  const settings = getSettings()
  if (!settings.sshHost?.trim() || !isRootProxmoxSshConfigured(settings)) return null
  try {
    const out = await sshExec(
      settings.sshHost,
      settings.sshPort,
      settings.proxmoxSshUser || "root",
      settings.proxmoxSshPassword || "",
      `stat -c %Y "${logPath}" 2>/dev/null || echo 0`,
    )
    const sec = parseInt(out.trim(), 10)
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : null
  } catch {
    return null
  }
}

/** Full ansible.log byte length on Ludus host (uncapped). */
export async function readLudusAnsibleLogByteLength(rangeId: string): Promise<number | null> {
  const logPath = ludusAnsibleLogPath(rangeId)
  if (!logPath) return null
  const settings = getSettings()
  if (!settings.sshHost?.trim() || !isRootProxmoxSshConfigured(settings)) return null
  try {
    const out = await sshExec(
      settings.sshHost,
      settings.sshPort,
      settings.proxmoxSshUser || "root",
      settings.proxmoxSshPassword || "",
      `wc -c < "${logPath}" 2>/dev/null || echo 0`,
    )
    const n = parseInt(out.trim(), 10)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

/** Uncapped ansible.log suffix from byte offset (for testing-mode reconcile when HTTP tail truncates). */
export async function readLudusAnsibleLogSuffixFromByteOffset(
  rangeId: string,
  byteOffset: number,
): Promise<string | null> {
  const logPath = ludusAnsibleLogPath(rangeId)
  if (!logPath) return null
  const settings = getSettings()
  if (!settings.sshHost?.trim() || !isRootProxmoxSshConfigured(settings)) return null
  const start = Math.max(1, Math.floor(byteOffset) + 1)
  try {
    const content = await sshExec(
      settings.sshHost,
      settings.sshPort,
      settings.proxmoxSshUser || "root",
      settings.proxmoxSshPassword || "",
      `tail -c +${start} "${logPath}" 2>/dev/null | head -c 524288 || true`,
    )
    return content.trim() ? content : null
  } catch {
    return null
  }
}


async function sshAnsibleLogWithDiag(rangeId: string, reasonKey: string, reasonMsg: string): Promise<string | null> {
  const viaSsh = await readLudusAnsibleLogViaSsh(rangeId)
  if (viaSsh) {
    diagThrottled(reasonKey, reasonMsg, 600_000)
  }
  return viaSsh
}

/** Tail of Ludus deploy text — Ludus HTTP `/range/logs` or SSH ansible.log (PLAY RECAP). */
export async function readLudusRangeLogsForReconcile(
  rangeId: string,
  opts?: { taskLudusApiKey?: string },
): Promise<string | null> {
  const settings = getSettings()
  const rootKey = (settings.rootApiKey ?? "").trim()
  const taskKey = opts?.taskLudusApiKey?.trim() ?? ""

  const path = `/range/logs?rangeID=${encodeURIComponent(rangeId)}`

  // Match `api/logs/stream`: main Ludus URL + range owner's Ludus user API key.
  // When present, never fall through to LUDUS_ROOT_API_KEY — that is the PB admin
  // password and is not a valid Ludus v2 X-API-KEY for /range/logs.
  if (taskKey) {
    const resTask = await ludusGet<{ result?: string }>(path, {
      apiKey: taskKey,
      useAdminEndpoint: false,
      timeout: 45_000,
    })
    if (resTask.status >= 200 && resTask.status < 300) {
      const rawT = resTask.data?.result
      if (typeof rawT === "string" && rawT.length) {
        return capLudusLogTail(rawT)
      }
      return sshAnsibleLogWithDiag(
        rangeId,
        `logs-ssh-empty-http-${rangeId}`,
        `reconcile: Ludus /range/logs empty for rangeId=${rangeId}; using SSH ansible.log`,
      )
    }
    if (resTask.status === 401 || resTask.status === 403) {
      diagThrottled(
        `logs-owner-auth-${rangeId}`,
        `GET /range/logs failed with range owner's API key for rangeId=${rangeId}: HTTP ${resTask.status} ${resTask.error ?? ""}`.trim(),
        120_000,
      )
      return readLudusAnsibleLogViaSsh(rangeId)
    }
    diagThrottled(
      `logs-owner-http-${rangeId}`,
      `GET /range/logs (owner key) failed for rangeId=${rangeId}: HTTP ${resTask.status} ${resTask.error ?? ""}`.trim(),
      120_000,
    )
    return sshAnsibleLogWithDiag(
      rangeId,
      `logs-ssh-ok-${rangeId}`,
      `reconcile: Ludus /range/logs unavailable; using SSH ansible.log for PLAY RECAP (rangeId=${rangeId})`,
    )
  }

  diagThrottled(
    `logs-no-owner-key-${rangeId}`,
    `reconcile: no Ludus user API key on GOAD task for rangeId=${rangeId} — /range/logs needs the range owner's key (same as Range Logs stream)`,
    300_000,
  )

  if (rootKey) {
    const fetchLogs = (useAdmin: boolean) =>
      ludusGet<{ result?: string }>(path, {
        apiKey: rootKey,
        useAdminEndpoint: useAdmin,
        timeout: 45_000,
      })

    let res = await fetchLogs(true)
    if ((res.status === 401 || res.status === 403) && settings.ludusUrl?.trim()) {
      diagThrottled(
        `logs-fallback-${rangeId}`,
        `GET /range/logs (admin) HTTP ${res.status} — retrying on main Ludus API (root key).`,
        600_000,
      )
      res = await fetchLogs(false)
    }

    if (res.status >= 200 && res.status < 300) {
      const raw = res.data?.result
      if (typeof raw === "string" && raw.length) return capLudusLogTail(raw)
    } else if (res.status === 401 || res.status === 403) {
      diagThrottled(
        `logs-http-${rangeId}`,
        `GET /range/logs failed for rangeId=${rangeId}: HTTP ${res.status} ${res.error ?? ""} — LUDUS_ROOT_API_KEY is the PB admin password, not a Ludus v2 X-API-KEY. Store the task owner's Ludus user API key on the GOAD task instead.`.trim(),
        120_000,
      )
    } else {
      diagThrottled(
        `logs-http-${rangeId}`,
        `GET /range/logs failed for rangeId=${rangeId}: HTTP ${res.status} ${res.error ?? ""}`.trim(),
        120_000,
      )
    }
  }

  return sshAnsibleLogWithDiag(
    rangeId,
    `logs-ssh-ok-${rangeId}`,
    `reconcile: Ludus /range/logs unavailable or empty; using SSH ansible.log for PLAY RECAP (rangeId=${rangeId})`,
  )
}

export async function tryReconcileStuckDeploySnapshot(args: {
  taskId: string
  instanceId?: string
  status: string
  logText: string
  /** Session Ludus user API key from the GOAD task — same credential as Range Logs stream. */
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
    if (!rootApiKey) {
      diagThrottled(
        `task-${taskId}-no-root-key`,
        `task ${taskId}: skip reconcile (set Ludus root API key in LUX settings for admin /range + PocketBase patch)`,
        300_000,
      )
      return false
    }

    const rootCreds = rootPasswordCredsIfSet(settings)
    const fromFile = (await readGoadRangeId(instanceId, rootCreds))?.trim()
    const fromLocal = getInstanceRangeLocal(instanceId)?.trim()
    const fromHandoffTask = getHandoffByTaskId(taskId)?.rangeId?.trim()
    const fromHandoffInstance = getHandoffByInstanceId(instanceId)?.rangeId?.trim()
    const rid = fromFile || fromLocal || fromHandoffTask || fromHandoffInstance
    if (!rid) {
      diagThrottled(
        `task-${taskId}-no-rangeid`,
        `task ${taskId}: skip reconcile (no rangeId: .goad_range_id, goad_instance_ranges, deploy_handoffs all empty for task/instance)`,
        120_000,
      )
      return false
    }

    const recapGoad = logText.lastIndexOf("PLAY RECAP")
    const goadRecapOk = recapGoad >= 0 && parseAnsibleRecapAllOk(logText, recapGoad)

    let ludusBlock: string | null = null
    if (!goadRecapOk) {
      ludusBlock = await readLudusRangeLogsForReconcile(rid, { taskLudusApiKey: ludusApiKey })
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

    const current = await readRangeStateForReconcile(rid)
    if (!current) {
      diagThrottled(
        `range-${rid}-no-state`,
        `rangeId=${rid}: skip reconcile (no rangeState from PocketBase + Ludus GET /range)`,
        120_000,
      )
      return false
    }
    if (current !== "DEPLOYING" && current !== "WAITING") return false

    lastAttemptAt.set(taskId, now)

    const err = await setPbRangeState(rid, "SUCCESS")
    if (err) {
      console.warn(`[goad-ludus-reconcile] PocketBase SUCCESS patch failed for ${rid}: ${err}`)
      return false
    }

    const afterPatch = await readRangeStateForReconcile(rid)
    const stillDeploying =
      afterPatch === "DEPLOYING" ||
      afterPatch === "WAITING" ||
      afterPatch == null

    if (stillDeploying) {
      lastAttemptAt.delete(taskId)
      console.warn(
        `[goad-ludus-reconcile] PocketBase PATCH returned OK but rangeState is still ${afterPatch ?? "unknown"} for "${rid}" — will retry (Ludus may overwrite PB or read lag).`,
      )
      return false
    }

    reconciledTaskIds.add(taskId)
    console.info(
      `[goad-ludus-reconcile] Patched rangeState=SUCCESS for "${rid}" (task ${taskId}; goadRecap=${goadRecapOk} ludusRecap=${ludusRecapOk} deployPollLines=${deployPollsFull}; verified=${afterPatch})`,
    )
    return true
  } catch (e) {
    console.warn("[goad-ludus-reconcile]", e)
    return false
  }
}

/**
 * Post-GOAD `network`-tag deploy (firewall) runs after the GOAD SSH task has
 * already exited, so `appendLine` reconcile never fires. If PocketBase still
 * shows DEPLOYING while Ludus already reports SUCCESS, patch PB. If Ludus is
 * still DEPLOYING/WAITING but `/range/logs` shows a clean latest PLAY RECAP,
 * patch PB (Ansible finished; Ludus/PB desync).
 *
 * Does **not** patch when Ludus reports ERROR/ABORTED. Recap fallback runs only
 * when Ludus state is DEPLOYING or WAITING (avoids trusting stale recap after ERROR).
 */
export async function reconcilePbAfterFollowOnLudusDeploy(
  rangeId: string,
  ludusUserApiKey?: string,
): Promise<{ patched: boolean; detail: string }> {
  const rid = rangeId.trim()
  if (!rid) return { patched: false, detail: "empty rangeId" }

  const pbRow = await fetchPbRangeStatus(rid)
  const pbState = String(pbRow?.rangeState ?? "").trim().toUpperCase()
  if (pbState !== "DEPLOYING" && pbState !== "WAITING") {
    return { patched: false, detail: `pocketbase not stuck (${pbState || "unknown"})` }
  }

  const key = ludusUserApiKey?.trim()
  if (!key) {
    return { patched: false, detail: "no Ludus API key for GET /range" }
  }

  let ludusState: string | null = null
  const lr = await ludusGet<unknown>(`/range?rangeID=${encodeURIComponent(rid)}`, {
    apiKey: key,
    useAdminEndpoint: false,
    timeout: 45_000,
  })
  if (lr.status >= 200 && lr.status < 300 && lr.data !== undefined) {
    ludusState = extractRangeStateFromLudusGetBody(lr.data, rid)
  }

  if (ludusState === "ERROR" || ludusState === "ABORTED") {
    return { patched: false, detail: `ludus terminal ${ludusState}` }
  }

  if (ludusState === "SUCCESS") {
    const err = await setPbRangeState(rid, "SUCCESS")
    if (err) return { patched: false, detail: err }
    return { patched: true, detail: "pocketbase synced from ludus SUCCESS" }
  }

  if (ludusState !== "DEPLOYING" && ludusState !== "WAITING") {
    return {
      patched: false,
      detail: `ludus state ${ludusState ?? "unreadable"} — not patching`,
    }
  }

  const ludusBlock = await readLudusRangeLogsForReconcile(rid, { taskLudusApiKey: key })
  const recapLudus = ludusBlock ? ludusBlock.lastIndexOf("PLAY RECAP") : -1
  const ludusRecapOk =
    ludusBlock != null &&
    recapLudus >= 0 &&
    parseAnsibleRecapAllOk(ludusBlock, recapLudus)
  if (!ludusRecapOk) {
    return {
      patched: false,
      detail: "pocketbase stuck; ludus still deploying and no clean PLAY RECAP in logs",
    }
  }

  const err = await setPbRangeState(rid, "SUCCESS")
  if (err) return { patched: false, detail: err }
  const after = await readRangeStateForReconcile(rid)
  if (after === "DEPLOYING" || after === "WAITING" || after == null) {
    return { patched: false, detail: "PATCH ok but rangeState still deploying (retry later)" }
  }
  return { patched: true, detail: "pocketbase patched from PLAY RECAP while ludus API lagged" }
}
