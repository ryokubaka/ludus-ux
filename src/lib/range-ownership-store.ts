/**
 * Persistent range-ownership store backed by SQLite.
 *
 * The Ludus API does not always surface `userID` in `GET /range/all`
 * responses, so admin-confirmed assignments would be lost on container restart
 * if stored only in process memory.  This table is the authoritative source
 * of truth for any assignment made through the Ludus-UI admin panel.
 *
 * It is merged with (and takes priority over) Ludus API heuristics in the
 * /api/admin/ranges-data route.
 */

import { getDb } from "./db"

let _schemaReady = false
function ensureTable() {
  if (_schemaReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS range_ownership (
      rangeID     TEXT    NOT NULL PRIMARY KEY,
      userID      TEXT    NOT NULL,
      assignedBy  TEXT    NOT NULL DEFAULT 'admin',
      assignedAt  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_range_ownership_user
      ON range_ownership(userID);
  `)
  _schemaReady = true
}

/** Return all stored assignments as a rangeID → userID Map. */
export function getAllOwnership(): Map<string, string> {
  ensureTable()
  const rows = getDb()
    .prepare("SELECT rangeID, userID FROM range_ownership")
    .all() as { rangeID: string; userID: string }[]
  return new Map(rows.map((r) => [r.rangeID, r.userID]))
}

/** Upsert an ownership record. Idempotent. */
export function setOwnership(rangeID: string, userID: string, assignedBy = "admin") {
  ensureTable()
  getDb()
    .prepare(
      `INSERT INTO range_ownership (rangeID, userID, assignedBy, assignedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(rangeID) DO UPDATE
         SET userID = excluded.userID,
             assignedBy = excluded.assignedBy,
             assignedAt = excluded.assignedAt`,
    )
    .run(rangeID, userID, assignedBy, Date.now())
}

/** Remove a record (e.g. when the range is deleted). */
export function removeOwnership(rangeID: string) {
  ensureTable()
  getDb().prepare("DELETE FROM range_ownership WHERE rangeID = ?").run(rangeID)
}
