import "server-only"

import { getDb } from "@/lib/core/db"

/**
 * Canvas node positions for the visual range builder.
 *
 * Positions are LUX-local UI state, not part of range-config.yml (Ludus rejects
 * unknown top-level keys). They are keyed by range id and the effective
 * username so an impersonation session does not overwrite another user's layout.
 */

export interface NodePosition {
  x: number
  y: number
  /** Operator resize. Absent until the box is resized. */
  width?: number
  height?: number
}

/** node id → position. Node ids are the builder's own (vm name, `vlan:<n>`, `domain:<fqdn>`, `router`). */
export type RangeBuilderLayout = Record<string, NodePosition>

let _schemaReady = false

function ensureTable() {
  if (_schemaReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS range_builder_layouts (
      range_id    TEXT    NOT NULL,
      username    TEXT    NOT NULL,
      layout      TEXT    NOT NULL,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (range_id, username)
    );
  `)
  _schemaReady = true
}

function isPosition(value: unknown): value is NodePosition {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return Number.isFinite(v.x) && Number.isFinite(v.y)
}

function sanitizeLayout(value: unknown): RangeBuilderLayout {
  const out: RangeBuilderLayout = {}
  if (!value || typeof value !== "object") return out
  for (const [key, pos] of Object.entries(value as Record<string, unknown>)) {
    if (!key || !isPosition(pos)) continue
    const width = typeof pos.width === "number" && pos.width > 0 ? pos.width : undefined
    const height = typeof pos.height === "number" && pos.height > 0 ? pos.height : undefined
    out[key] = {
      x: pos.x,
      y: pos.y,
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    }
  }
  return out
}

export function getRangeBuilderLayout(rangeId: string, username: string): RangeBuilderLayout {
  const rid = rangeId.trim()
  const user = username.trim().toLowerCase()
  if (!rid || !user) return {}
  ensureTable()
  const row = getDb()
    .prepare(`SELECT layout FROM range_builder_layouts WHERE range_id = ? AND username = ?`)
    .get(rid, user) as { layout?: string } | undefined
  if (!row?.layout) return {}
  try {
    return sanitizeLayout(JSON.parse(row.layout))
  } catch {
    return {}
  }
}

export function saveRangeBuilderLayout(
  rangeId: string,
  username: string,
  layout: RangeBuilderLayout,
): void {
  const rid = rangeId.trim()
  const user = username.trim().toLowerCase()
  if (!rid || !user) return
  ensureTable()
  const clean = sanitizeLayout(layout)
  getDb()
    .prepare(
      `INSERT INTO range_builder_layouts (range_id, username, layout, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(range_id, username) DO UPDATE SET
         layout = excluded.layout,
         updated_at = excluded.updated_at`,
    )
    .run(rid, user, JSON.stringify(clean), Date.now())
}
