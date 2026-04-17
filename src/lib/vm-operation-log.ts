import { randomUUID } from "crypto"
import { getDb } from "@/lib/db"

export type VmOperationKind = "destroy_vm" | "remove_extension"

export interface VmOperationInsert {
  username: string
  kind: VmOperationKind
  rangeId?: string | null
  instanceId?: string | null
  vmId?: number | null
  vmName?: string | null
  extensionName?: string | null
  status: "ok" | "error"
  detail?: string | null
}

export interface VmOperationEntry {
  id: string
  ts: number
  username: string
  kind: VmOperationKind
  rangeId: string | null
  instanceId: string | null
  vmId: number | null
  vmName: string | null
  extensionName: string | null
  status: "ok" | "error"
  detail: string | null
}

export interface ListVmOperationsQuery {
  rangeId?: string | null
  instanceId?: string | null
  /** When set, only this user's rows are returned. Admins pass `null` to see everyone. */
  username?: string | null
  /** Default 100, capped at 500. */
  limit?: number
}

/** Read rows from `vm_operation_log` newest-first, filtered by the given scope. */
export function listVmOperations(q: ListVmOperationsQuery = {}): VmOperationEntry[] {
  const db = getDb()
  const where: string[] = []
  const params: (string | number | null)[] = []
  if (q.rangeId) {
    where.push("range_id = ?")
    params.push(q.rangeId)
  }
  if (q.instanceId) {
    where.push("instance_id = ?")
    params.push(q.instanceId)
  }
  if (q.username) {
    where.push("username = ?")
    params.push(q.username)
  }
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500)
  const sql = `
    SELECT id, ts, username, kind, range_id, instance_id, vm_id, vm_name, extension_name, status, detail
    FROM vm_operation_log
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ts DESC
    LIMIT ?
  `
  const rows = db.prepare(sql).all(...params, limit) as Array<{
    id: string
    ts: number
    username: string
    kind: string
    range_id: string | null
    instance_id: string | null
    vm_id: number | null
    vm_name: string | null
    extension_name: string | null
    status: string
    detail: string | null
  }>
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    username: r.username,
    kind: r.kind as VmOperationKind,
    rangeId: r.range_id,
    instanceId: r.instance_id,
    vmId: r.vm_id,
    vmName: r.vm_name,
    extensionName: r.extension_name,
    status: (r.status === "error" ? "error" : "ok") as "ok" | "error",
    detail: r.detail,
  }))
}

/** Append one row to `vm_operation_log` (LUX-local audit trail for VM / extension removals). */
export function insertVmOperation(entry: VmOperationInsert): void {
  const db = getDb()
  const id = randomUUID()
  const ts = Date.now()
  db.prepare(
    `INSERT INTO vm_operation_log (
      id, ts, username, kind, range_id, instance_id, vm_id, vm_name, extension_name, status, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    ts,
    entry.username,
    entry.kind,
    entry.rangeId ?? null,
    entry.instanceId ?? null,
    entry.vmId ?? null,
    entry.vmName ?? null,
    entry.extensionName ?? null,
    entry.status,
    entry.detail ?? null,
  )
}
