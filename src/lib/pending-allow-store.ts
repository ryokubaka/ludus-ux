/**
 * Persistent pending-allow store backed by SQLite.
 *
 * Tracks unconfirmed domain/IP allow and deny operations for testing mode.
 * Previously this state lived in browser sessionStorage, which meant it was
 * lost on logout, browser switch, or container restart.  Moving it to SQLite
 * makes it durable across all of those scenarios.
 *
 * "add"    = user called POST /testing/allow — entry not yet in Ludus's list
 * "remove" = user called POST /testing/deny  — entry still in Ludus's list
 */

import { getDb } from "./db"

export type PendingAllowOpType = "add" | "remove"

export interface PendingAllowOps {
  adds: string[]
  removes: string[]
}

export interface PendingAllowEntry {
  entry: string
  createdAt: number
}

export interface PendingAllowOpsWithTimestamps {
  adds: PendingAllowEntry[]
  removes: PendingAllowEntry[]
}

let _schemaReady = false
function ensureTable() {
  if (_schemaReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS pending_allow_ops (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      rangeId   TEXT    NOT NULL,
      username  TEXT    NOT NULL,
      entry     TEXT    NOT NULL,
      opType    TEXT    NOT NULL,
      createdAt INTEGER NOT NULL,
      UNIQUE(rangeId, username, entry, opType)
    );
    CREATE INDEX IF NOT EXISTS idx_pending_allow_lookup
      ON pending_allow_ops(rangeId, username);
  `)
  _schemaReady = true
}

/** Return all pending adds and removes for a range+user. */
export function getPendingAllows(rangeId: string, username: string): PendingAllowOps {
  ensureTable()
  const rows = getDb()
    .prepare("SELECT entry, opType FROM pending_allow_ops WHERE rangeId = ? AND username = ?")
    .all(rangeId, username) as { entry: string; opType: string }[]

  const adds: string[] = []
  const removes: string[] = []
  for (const r of rows) {
    if (r.opType === "add") adds.push(r.entry)
    else if (r.opType === "remove") removes.push(r.entry)
  }
  return { adds, removes }
}

/** Like getPendingAllows but includes createdAt timestamps for time-based reconciliation. */
export function getPendingAllowsWithTimestamps(rangeId: string, username: string): PendingAllowOpsWithTimestamps {
  ensureTable()
  const rows = getDb()
    .prepare("SELECT entry, opType, createdAt FROM pending_allow_ops WHERE rangeId = ? AND username = ?")
    .all(rangeId, username) as { entry: string; opType: string; createdAt: number }[]

  const adds: PendingAllowEntry[] = []
  const removes: PendingAllowEntry[] = []
  for (const r of rows) {
    const e = { entry: r.entry, createdAt: r.createdAt }
    if (r.opType === "add") adds.push(e)
    else if (r.opType === "remove") removes.push(e)
  }
  return { adds, removes }
}

/** Record a pending add or remove.  Idempotent (UNIQUE constraint + INSERT OR IGNORE). */
export function addPendingAllow(
  rangeId: string,
  username: string,
  entry: string,
  opType: PendingAllowOpType,
) {
  ensureTable()
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO pending_allow_ops (rangeId, username, entry, opType, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(rangeId, username, entry, opType, Date.now())
}

/** Remove specific pending entries (used during reconciliation). */
export function removePendingAllows(
  rangeId: string,
  username: string,
  entries: string[],
  opType: PendingAllowOpType,
) {
  if (entries.length === 0) return
  ensureTable()
  const db = getDb()
  const stmt = db.prepare(
    "DELETE FROM pending_allow_ops WHERE rangeId = ? AND username = ? AND entry = ? AND opType = ?"
  )
  const tx = db.transaction(() => {
    for (const entry of entries) {
      stmt.run(rangeId, username, entry, opType)
    }
  })
  tx()
}

/** Prune entries older than 1 hour (safety net for orphans). */
export function pruneStalePendingAllows() {
  ensureTable()
  const cutoff = Date.now() - 60 * 60 * 1000
  getDb().prepare("DELETE FROM pending_allow_ops WHERE createdAt < ?").run(cutoff)
}
