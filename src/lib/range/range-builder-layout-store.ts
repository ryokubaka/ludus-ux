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

const MAX_LAYOUT_NODES = 2000
const MAX_NODE_ID_LENGTH = 512

/** A node id may be stored. `__proto__`, `constructor`, and `prototype` are not names we will create. */
function layoutNodeId(raw: string): string | null {
  const id = raw.trim()
  if (id.length < 1 || id.length > MAX_NODE_ID_LENGTH) return null
  if (id === "__proto__" || id === "constructor" || id === "prototype") return null
  return id
}

/**
 * Copy positions without using the caller's string as a property name.
 * `obj[key] =` would let a saved id such as `__proto__` replace the object's prototype.
 * The id is only placed into the result by parsing JSON we just serialized.
 */
export function sanitizeRangeBuilderLayout(value: unknown): RangeBuilderLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const parts: string[] = []
  const seen = new Set<string>()
  for (const [raw, pos] of Object.entries(value as Record<string, unknown>)) {
    if (parts.length >= MAX_LAYOUT_NODES) break
    const id = layoutNodeId(raw)
    if (!id || seen.has(id) || !isPosition(pos)) continue
    seen.add(id)
    const width = typeof pos.width === "number" && pos.width > 0 ? pos.width : undefined
    const height = typeof pos.height === "number" && pos.height > 0 ? pos.height : undefined
    const clean: NodePosition = {
      x: pos.x,
      y: pos.y,
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    }
    parts.push(`${JSON.stringify(id)}:${JSON.stringify(clean)}`)
  }
  if (parts.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(`{${parts.join(",")}}`)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as RangeBuilderLayout
  } catch {
    return {}
  }
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
    return sanitizeRangeBuilderLayout(JSON.parse(row.layout))
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
  const clean = sanitizeRangeBuilderLayout(layout)
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
