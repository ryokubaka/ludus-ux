import "server-only"

import { resolveGlobalBlueprintServiceApiKey } from "@/lib/blueprint-global-install"
import { getDb } from "@/lib/db"
import type { ResolvedSession } from "@/lib/session"

let _schemaReady = false

function ensureTable() {
  if (_schemaReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS source_publication (
      source_id   TEXT    PRIMARY KEY,
      published   INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `)
  _schemaReady = true
}

export function listPublishedSourceIds(): Set<string> {
  ensureTable()
  const rows = getDb()
    .prepare(`SELECT source_id FROM source_publication WHERE published = 1`)
    .all() as Array<{ source_id: string }>
  return new Set(rows.map((row) => row.source_id.trim().toLowerCase()).filter(Boolean))
}

export function isSourcePublished(sourceId: string): boolean {
  const id = sourceId.trim().toLowerCase()
  if (!id) return false
  return listPublishedSourceIds().has(id)
}

export function setSourcePublished(sourceId: string, published: boolean): void {
  const id = sourceId.trim().toLowerCase()
  if (!id) return
  ensureTable()
  getDb()
    .prepare(
      `INSERT INTO source_publication (source_id, published, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET
         published = excluded.published,
         updated_at = excluded.updated_at`,
    )
    .run(id, published ? 1 : 0, Date.now())
}

/**
 * Ludus only lists a source for the user who registered it.
 * A published source is read with the admin key so other users can browse it.
 */
export function catalogReadApiKey(
  session: Pick<ResolvedSession, "isAdmin" | "apiKey">,
  callerApiKey: string,
  sourceId: string,
): string {
  if (session.isAdmin || !isSourcePublished(sourceId)) return callerApiKey
  return resolveGlobalBlueprintServiceApiKey(session) || callerApiKey
}
