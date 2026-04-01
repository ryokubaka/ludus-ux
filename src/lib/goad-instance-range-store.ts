/**
 * Local SQLite-backed store for GOAD instance → Ludus range associations.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The SSH-written .goad_range_id file is the canonical on-server record, but
 * writing it requires root SSH (password or mounted private key).  When those
 * credentials are not configured the write fails silently, leaving the new
 * instance with no range association in the UI.
 *
 * This local store is the PRIMARY record written by the set-range route.
 * The SSH file write is a secondary, best-effort sync.  The instances API
 * checks this store first so range assignments always survive a page reload
 * regardless of SSH configuration.
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
  } catch {
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
  } catch {
    return new Map()
  }
}
