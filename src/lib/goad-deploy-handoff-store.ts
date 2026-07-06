/**
 * Deploy handoff store — persists wizard intent to SQLite before the GOAD
 * execute call so the server can complete post-deploy linkage (range assignment,
 * pending-network application) even if the user navigates away.
 *
 * Flow:
 *   1. Wizard POSTs to /api/goad/deploy-handoff with rangeId, optional instanceId,
 *      and optional network rules snapshot. Returns a handoffId.
 *   2. Wizard calls /api/goad/execute (which starts the GOAD SSH task).
 *   3. Once the taskId is known, the wizard calls linkHandoffToTask() via
 *      /api/goad/deploy-handoff PATCH so the server can find the handoff by taskId
 *      when the task completes.
 *   4. On task complete, runAfterGoadTaskCompleteIfNeeded reads the handoff
 *      for rangeId/instanceId/network rules, falling back to in-memory state.
 */

import { randomUUID } from "crypto"
import { getDb } from "@/lib/db"

export interface DeployHandoff {
  id: string
  taskId?: string
  instanceId?: string
  rangeId: string
  username: string
  networkRulesJson?: string
  createdAt: number
  linkedAt?: number
}

type HandoffRow = {
  id: string
  task_id: string | null
  instance_id: string | null
  range_id: string
  username: string
  network_rules_json: string | null
  created_at: number
  linked_at: number | null
}

function rowToHandoff(row: HandoffRow): DeployHandoff {
  return {
    id: row.id,
    taskId: row.task_id ?? undefined,
    instanceId: row.instance_id ?? undefined,
    rangeId: row.range_id,
    username: row.username,
    networkRulesJson: row.network_rules_json ?? undefined,
    createdAt: row.created_at,
    linkedAt: row.linked_at ?? undefined,
  }
}

export function createDeployHandoff(args: {
  instanceId?: string
  rangeId: string
  username: string
  networkRulesJson?: string
}): DeployHandoff {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO deploy_handoffs (id, instance_id, range_id, username, network_rules_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, args.instanceId ?? null, args.rangeId, args.username, args.networkRulesJson ?? null, now)
  return {
    id,
    instanceId: args.instanceId,
    rangeId: args.rangeId,
    username: args.username,
    networkRulesJson: args.networkRulesJson,
    createdAt: now,
  }
}

/** Link a handoff to the GOAD task once the execute call returns the taskId. */
export function linkHandoffToTask(handoffId: string, taskId: string): void {
  getDb()
    .prepare(`UPDATE deploy_handoffs SET task_id = ?, linked_at = ? WHERE id = ?`)
    .run(taskId, Date.now(), handoffId)
}

/** Look up a handoff by taskId — used by the pending-network workflow on task complete. */
export function getHandoffByTaskId(taskId: string): DeployHandoff | null {
  const row = getDb()
    .prepare(`SELECT * FROM deploy_handoffs WHERE task_id = ? LIMIT 1`)
    .get(taskId) as HandoffRow | undefined
  return row ? rowToHandoff(row) : null
}

/** Look up a handoff by instanceId — used as a fallback when taskId is not set yet. */
export function getHandoffByInstanceId(instanceId: string): DeployHandoff | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM deploy_handoffs WHERE instance_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(instanceId) as HandoffRow | undefined
  return row ? rowToHandoff(row) : null
}

/** Clean up handoffs older than 48 hours (best-effort maintenance). */
export function pruneOldHandoffs(): void {
  try {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000
    getDb().prepare(`DELETE FROM deploy_handoffs WHERE created_at < ?`).run(cutoff)
  } catch (err) {
    console.warn("[deploy-handoff] pruneOldHandoffs:", (err as Error).message)
  }
}
