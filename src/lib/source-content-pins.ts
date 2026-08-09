import "server-only"

import { getDb } from "@/lib/db"
import type { SourceInstallSelection } from "@/lib/ludus-source-client"
import {
  resolveSourceBlueprints,
  resolveSourceCollections,
  resolveSourceRoles,
  resolveSourceTemplates,
} from "@/lib/source-catalog-resolver"
import { blueprintShortName } from "@/lib/registered-ludus-sources"

export type SourceContentKind = "blueprint" | "template" | "role" | "collection"

export interface SourceContentPin {
  sourceId: string
  kind: SourceContentKind
  name: string
  version: string
  catalogRef?: string
  updatedAt: number
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

export function listSourceContentPins(sourceId: string): SourceContentPin[] {
  const sid = sourceId.trim()
  if (!sid) return []
  const rows = getDb()
    .prepare(
      `SELECT source_id, kind, name, version, catalog_ref, updated_at
       FROM source_content_pins WHERE source_id = ?`,
    )
    .all(sid) as Array<{
    source_id: string
    kind: string
    name: string
    version: string
    catalog_ref: string | null
    updated_at: number
  }>
  return rows.map((r) => ({
    sourceId: r.source_id,
    kind: r.kind as SourceContentKind,
    name: r.name,
    version: r.version,
    catalogRef: r.catalog_ref || undefined,
    updatedAt: r.updated_at,
  }))
}

/** name (lower) → version for one kind. */
export function sourceContentPinVersionMap(
  sourceId: string,
  kind: SourceContentKind,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pin of listSourceContentPins(sourceId)) {
    if (pin.kind !== kind) continue
    out[normalizeName(pin.name)] = pin.version
  }
  return out
}

export function upsertSourceContentPin(pin: {
  sourceId: string
  kind: SourceContentKind
  name: string
  version: string
  catalogRef?: string
}): void {
  const sourceId = pin.sourceId.trim()
  const name = pin.name.trim()
  const version = pin.version.trim()
  if (!sourceId || !name || !version) return
  getDb()
    .prepare(
      `INSERT INTO source_content_pins (source_id, kind, name, version, catalog_ref, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, kind, name) DO UPDATE SET
         version = excluded.version,
         catalog_ref = excluded.catalog_ref,
         updated_at = excluded.updated_at`,
    )
    .run(sourceId, pin.kind, name, version, pin.catalogRef ?? null, Date.now())
}

function findVersion(
  items: Array<{ name?: string; fqcn?: string; version?: string }>,
  want: string,
): string | undefined {
  const key = normalizeName(want)
  const short = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key
  for (const item of items) {
    const names = [item.fqcn, item.name].filter(Boolean).map((n) => normalizeName(n!))
    for (const n of names) {
      if (n === key) return item.version?.trim() || undefined
      const nShort = n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : n
      if (nShort === short || nShort === key) return item.version?.trim() || undefined
    }
  }
  return undefined
}

/**
 * After a successful source install/re-sync, pin catalog tip versions so LUX can
 * detect later bumps even when Ludus omits installed versions.
 */
export async function pinSourceInstallSelection(
  apiKey: string,
  sourceId: string,
  selection: SourceInstallSelection,
): Promise<void> {
  const sid = sourceId.trim()
  if (!sid) return

  if (selection.blueprints?.length) {
    const { items, catalogRef } = await resolveSourceBlueprints(apiKey, sid)
    for (const raw of selection.blueprints) {
      const name = blueprintShortName({ name: raw }) || raw.trim()
      const version = findVersion(
        items.map((i) => ({ name: blueprintShortName(i) || i.name, version: i.version })),
        name,
      )
      if (version) {
        upsertSourceContentPin({
          sourceId: sid,
          kind: "blueprint",
          name,
          version,
          catalogRef,
        })
      }
    }
  }

  if (selection.templates?.length) {
    const { items, catalogRef } = await resolveSourceTemplates(apiKey, sid)
    for (const name of selection.templates) {
      const version = findVersion(items, name)
      if (version) {
        upsertSourceContentPin({
          sourceId: sid,
          kind: "template",
          name: name.trim(),
          version,
          catalogRef,
        })
      }
    }
  }

  if (selection.localRoles?.length) {
    const { items, catalogRef } = await resolveSourceRoles(apiKey, sid)
    for (const name of selection.localRoles) {
      const version = findVersion(items, name)
      if (version) {
        upsertSourceContentPin({
          sourceId: sid,
          kind: "role",
          name: name.trim(),
          version,
          catalogRef,
        })
      }
    }
  }

  if (selection.localCollections?.length) {
    const { items, catalogRef } = await resolveSourceCollections(apiKey, sid)
    for (const name of selection.localCollections) {
      const version = findVersion(items, name)
      if (version) {
        upsertSourceContentPin({
          sourceId: sid,
          kind: "collection",
          name: name.trim(),
          version,
          catalogRef,
        })
      }
    }
  }
}
