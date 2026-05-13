/**
 * Durable SQLite markers tying LUX-initiated actions to Ludus range log history rows.
 * Server-only — import types from `@/lib/range-log-marker-types` in client code.
 */

import { randomBytes } from "crypto"
import { getDb } from "./db"
import type { LuxRangeDeployTagRun, LuxRangeTestingEvent, LuxTestingOpType } from "./range-log-marker-types"

export type { LuxRangeDeployTagRun, LuxRangeTestingEvent, LuxTestingOpType } from "./range-log-marker-types"

const PRUNE_MS = 60 * 24 * 60 * 60 * 1000 // 60 days

let _tablesReady = false
function ensureLuxMarkerTables() {
  if (_tablesReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS lux_range_testing_events (
      id            TEXT    PRIMARY KEY,
      range_id      TEXT    NOT NULL,
      username      TEXT    NOT NULL,
      op_type       TEXT    NOT NULL,
      range_op_id   TEXT,
      requested_at  INTEGER NOT NULL,
      completed_at  INTEGER NOT NULL,
      success       INTEGER NOT NULL DEFAULT 0,
      ludus_log_id  TEXT,
      detail        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lux_testing_range_user
      ON lux_range_testing_events(range_id, username, completed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lux_testing_ludus_id
      ON lux_range_testing_events(ludus_log_id);

    CREATE TABLE IF NOT EXISTS lux_range_deploy_tag_runs (
      id            TEXT    PRIMARY KEY,
      range_id      TEXT    NOT NULL,
      username      TEXT    NOT NULL,
      tags_csv      TEXT    NOT NULL,
      requested_at  INTEGER NOT NULL,
      ludus_log_id  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lux_deploy_tags_range_user
      ON lux_range_deploy_tag_runs(range_id, username, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lux_deploy_tags_ludus_id
      ON lux_range_deploy_tag_runs(ludus_log_id);
  `)
  _tablesReady = true
}

export function pruneLuxRangeLogMarkers() {
  ensureLuxMarkerTables()
  const cutoff = Date.now() - PRUNE_MS
  const db = getDb()
  db.prepare(`DELETE FROM lux_range_testing_events WHERE completed_at < ?`).run(cutoff)
  db.prepare(`DELETE FROM lux_range_deploy_tag_runs WHERE requested_at < ?`).run(cutoff)
}

export function insertLuxTestingEvent(row: {
  rangeId: string
  username: string
  opType: LuxTestingOpType
  rangeOpId: string | null
  requestedAt: number
  completedAt: number
  success: boolean
  ludusLogId?: string | null
  detail?: string | null
}): string {
  ensureLuxMarkerTables()
  const id = randomBytes(12).toString("hex")
  getDb()
    .prepare(
      `INSERT INTO lux_range_testing_events
       (id, range_id, username, op_type, range_op_id, requested_at, completed_at, success, ludus_log_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      row.rangeId,
      row.username,
      row.opType,
      row.rangeOpId,
      row.requestedAt,
      row.completedAt,
      row.success ? 1 : 0,
      row.ludusLogId ?? null,
      row.detail ?? null,
    )
  return id
}

export function updateLuxTestingEventLudusLogId(eventId: string, ludusLogId: string) {
  ensureLuxMarkerTables()
  getDb()
    .prepare(`UPDATE lux_range_testing_events SET ludus_log_id = ? WHERE id = ? AND ludus_log_id IS NULL`)
    .run(ludusLogId, eventId)
}

export function listLuxTestingEvents(rangeId: string, username: string, limit = 80): LuxRangeTestingEvent[] {
  ensureLuxMarkerTables()
  const rows = getDb()
    .prepare(
      `SELECT id, range_id AS rangeId, username, op_type AS opType, range_op_id AS rangeOpId,
              requested_at AS requestedAt, completed_at AS completedAt, success, ludus_log_id AS ludusLogId,
              detail AS detail
       FROM lux_range_testing_events
       WHERE range_id = ? AND username = ?
       ORDER BY completed_at DESC
       LIMIT ?`,
    )
    .all(rangeId, username, limit) as Array<
    Omit<LuxRangeTestingEvent, "success"> & { success: number }
  >
  return rows.map((r) => ({
    ...r,
    success: Boolean(r.success),
    ludusLogId: r.ludusLogId ?? null,
    rangeOpId: r.rangeOpId ?? null,
    detail: r.detail ?? null,
  }))
}

export function insertLuxDeployTagRun(row: {
  rangeId: string
  username: string
  tagsCsv: string
  requestedAt: number
  ludusLogId?: string | null
}): string {
  ensureLuxMarkerTables()
  const id = randomBytes(12).toString("hex")
  getDb()
    .prepare(
      `INSERT INTO lux_range_deploy_tag_runs (id, range_id, username, tags_csv, requested_at, ludus_log_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, row.rangeId, row.username, row.tagsCsv, row.requestedAt, row.ludusLogId ?? null)
  return id
}

export function updateLuxDeployTagRunLudusLogId(runId: string, ludusLogId: string) {
  ensureLuxMarkerTables()
  getDb()
    .prepare(`UPDATE lux_range_deploy_tag_runs SET ludus_log_id = ? WHERE id = ? AND ludus_log_id IS NULL`)
    .run(ludusLogId, runId)
}

export function listLuxDeployTagRuns(rangeId: string, username: string, limit = 120): LuxRangeDeployTagRun[] {
  ensureLuxMarkerTables()
  const rows = getDb()
    .prepare(
      `SELECT id, range_id AS rangeId, username, tags_csv AS tagsCsv,
              requested_at AS requestedAt, ludus_log_id AS ludusLogId
       FROM lux_range_deploy_tag_runs
       WHERE range_id = ? AND username = ?
       ORDER BY requested_at DESC
       LIMIT ?`,
    )
    .all(rangeId, username, limit) as LuxRangeDeployTagRun[]
  return rows.map((r) => ({ ...r, ludusLogId: r.ludusLogId ?? null }))
}
