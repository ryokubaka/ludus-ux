/**
 * Recorded deploy-log clocks. One generation per ansible.log the recorder has seen.
 * Hashes line up with `omitBlankLogLines(splitLogText(...))`.
 */

import { randomBytes } from "crypto"
import { getDb } from "@/lib/core/db"
import type { DeployLogClockEntry } from "@/lib/logs/log-line-timestamp"

const PRUNE_MS = 60 * 24 * 60 * 60 * 1000

export type DeployLogClockGeneration = {
  id: string
  entries: DeployLogClockEntry[]
}

let tablesReady = false

function ensureTables() {
  if (tablesReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS deploy_log_clock (
      range_id    TEXT    NOT NULL,
      generation  TEXT    NOT NULL,
      entries_json TEXT   NOT NULL,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (range_id, generation)
    );
    CREATE INDEX IF NOT EXISTS idx_deploy_log_clock_updated
      ON deploy_log_clock(updated_at);
  `)
  tablesReady = true
}

function parseEntries(raw: string): DeployLogClockEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: DeployLogClockEntry[] = []
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue
    const h = (row as { h?: unknown }).h
    const ms = (row as { ms?: unknown }).ms
    if (typeof h !== "string" || !h) continue
    if (typeof ms !== "number" || !Number.isFinite(ms)) continue
    out.push({ h, ms })
  }
  return out
}

export function listDeployLogClocks(rangeId: string): DeployLogClockGeneration[] {
  ensureTables()
  const rid = rangeId.trim()
  if (!rid) return []
  const rows = getDb()
    .prepare(
      `SELECT generation, entries_json FROM deploy_log_clock WHERE range_id = ? ORDER BY updated_at ASC`,
    )
    .all(rid) as { generation: string; entries_json: string }[]
  return rows.map((row) => ({ id: row.generation, entries: parseEntries(row.entries_json) }))
}

export function saveDeployLogClock(rangeId: string, generation: string, entries: DeployLogClockEntry[]): void {
  ensureTables()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO deploy_log_clock (range_id, generation, entries_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(range_id, generation) DO UPDATE SET
         entries_json = excluded.entries_json,
         updated_at = excluded.updated_at`,
    )
    .run(rangeId.trim(), generation, JSON.stringify(entries), now)
}

export function newDeployLogClockId(): string {
  return randomBytes(8).toString("hex")
}

export function pruneDeployLogClocks(): void {
  ensureTables()
  getDb().prepare(`DELETE FROM deploy_log_clock WHERE updated_at < ?`).run(Date.now() - PRUNE_MS)
}
