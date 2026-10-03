/**
 * Local SQLite-backed store for GOAD instance → Ludus range associations.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The SSH-written .goad_range_id file is the on-server record GOAD reads.
 * set-range and deploy linkage write that file as the workspace owner, then
 * update this store. A failed file write does not update the row.
 */

import { getDb } from "./db"

export function setInstanceRangeLocal(instanceId: string, rangeId: string): void {
  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO goad_instance_ranges (instance_id, range_id, updated_at)
         VALUES (?, ?, ?)`
      )
      .run(instanceId, rangeId, Date.now())
  } catch (err) {
    console.error("[goad-range-store] setInstanceRange failed:", err)
  }
}

export function getInstanceRangeLocal(instanceId: string): string | null {
  try {
    const row = getDb()
      .prepare("SELECT range_id FROM goad_instance_ranges WHERE instance_id = ?")
      .get(instanceId) as { range_id: string } | null
    return row?.range_id ?? null
  } catch (err) {
    console.warn("[goad-range-store] getInstanceRangeLocal:", (err as Error).message)
    return null
  }
}

/** Reverse lookup: Ludus rangeID → GOAD instance id (workspace folder name). */
export function getInstanceIdForRange(rangeId: string): string | null {
  try {
    const row = getDb()
      .prepare("SELECT instance_id FROM goad_instance_ranges WHERE range_id = ?")
      .get(rangeId) as { instance_id: string } | null
    return row?.instance_id ?? null
  } catch (err) {
    console.warn("[goad-range-store] getInstanceIdForRange:", (err as Error).message)
    return null
  }
}

/** Returns all known instance→range mappings as a Map for bulk enrichment. */
export function getAllInstanceRangesLocal(): Map<string, string> {
  try {
    const rows = getDb()
      .prepare("SELECT instance_id, range_id FROM goad_instance_ranges")
      .all() as { instance_id: string; range_id: string }[]
    return new Map(rows.map((r) => [r.instance_id, r.range_id]))
  } catch (err) {
    console.warn("[goad-range-store] getAllInstanceRangesLocal:", (err as Error).message)
    return new Map()
  }
}
