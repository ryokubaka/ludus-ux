/**
 * Persistent range-operation store backed by SQLite.
 *
 * Tracks "in-flight" operations on Ludus ranges (currently: testing mode
 * start/stop) so the UI can show accurate progress even after page refreshes,
 * tab changes, or browser restarts — because the state lives server-side, not
 * in the browser.
 *
 * Each operation has a 30-minute TTL; stale ops are ignored and pruned.
 */

import { randomBytes } from "crypto"
import { getDb } from "./db"

// One-time schema guard: creates the range_ops table if it doesn't exist.
// Called inside each exported function rather than at module level so that
// webpack/Next.js tree-shaking cannot eliminate it as an unused side effect.
let _schemaReady = false
function ensureRangeOpsTable() {
  if (_schemaReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS range_ops (
      id          TEXT    PRIMARY KEY,
      rangeId     TEXT    NOT NULL,
      username    TEXT    NOT NULL,
      opType      TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',
      startedAt   INTEGER NOT NULL,
      completedAt INTEGER,
      expectedTestingEnabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_range_ops_lookup
      ON range_ops(rangeId, username, status, startedAt);
  `)
  _schemaReady = true
}

export type RangeOpType    = "testing_start" | "testing_stop"
export type RangeOpStatus  = "pending" | "running" | "completed" | "error"

export interface RangeOp {
  id: string
  rangeId: string
  username: string
  opType: RangeOpType
  status: RangeOpStatus
  startedAt: number   // ms epoch
  completedAt: number | null
  /** 1 = testingEnabled should be true after this op; 0 = should be false */
  expectedTestingEnabled: number
}

const TTL_MS = 30 * 60 * 1000

/** Create a new pending operation record and return it. */
export function createRangeOp(rangeId: string, username: string, opType: RangeOpType): RangeOp {
  ensureRangeOpsTable()
  const db   = getDb()
  const id   = randomBytes(8).toString("hex")
  const now  = Date.now()
  const expectedTestingEnabled = opType === "testing_start" ? 1 : 0

  db.prepare(`
    INSERT INTO range_ops (id, rangeId, username, opType, status, startedAt, expectedTestingEnabled)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, rangeId, username, opType, now, expectedTestingEnabled)

  return { id, rangeId, username, opType, status: "pending", startedAt: now, completedAt: null, expectedTestingEnabled }
}

/** Transition an op from 'pending' → 'running'. */
export function markRangeOpRunning(id: string) {
  ensureRangeOpsTable()
  getDb().prepare(`UPDATE range_ops SET status = 'running' WHERE id = ?`).run(id)
}

/** Mark an op as completed or errored. */
export function completeRangeOp(id: string, success: boolean) {
  ensureRangeOpsTable()
  getDb().prepare(`UPDATE range_ops SET status = ?, completedAt = ? WHERE id = ?`)
         .run(success ? "completed" : "error", Date.now(), id)
}

/**
 * Returns the most recent non-terminal op for the given range + user, or null.
 * Ops older than TTL_MS are treated as non-existent.
 */
export function getActiveRangeOp(rangeId: string, username: string): RangeOp | null {
  ensureRangeOpsTable()
  const cutoff = Date.now() - TTL_MS
  const row = getDb().prepare(`
    SELECT * FROM range_ops
    WHERE rangeId = ? AND username = ?
      AND status IN ('pending', 'running')
      AND startedAt > ?
    ORDER BY startedAt DESC LIMIT 1
  `).get(rangeId, username, cutoff) as RangeOp | undefined
  return row ?? null
}

/** Remove ops older than TTL_MS (call periodically to keep the table small). */
export function pruneOldRangeOps() {
  ensureRangeOpsTable()
  getDb().prepare(`DELETE FROM range_ops WHERE startedAt < ?`).run(Date.now() - TTL_MS)
}
