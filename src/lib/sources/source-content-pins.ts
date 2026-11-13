import "server-only"

import { getDb } from "@/lib/core/db"
import type { SourceInstallSelection } from "@/lib/sources/ludus-source-client"
import type { SourceCatalogVersionPins } from "@/lib/sources/source-install-client"
import {
  resolveSourceBlueprints,
  resolveSourceCollections,
  resolveSourceRoles,
  resolveSourceTemplates,
} from "@/lib/sources/source-catalog-resolver"
import { blueprintShortName } from "@/lib/sources/registered-ludus-sources"

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

/**
 * One role or collection name has one installed copy.
 * Installing it from this source drops the same name's pin on every other source.
 */
export function clearOtherSourceContentPins(opts: {
  exceptSourceId: string
  kind: SourceContentKind
  name: string
}): void {
  const except = opts.exceptSourceId.trim()
  const name = normalizeName(opts.name)
  if (!except || !name) return
  const short = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name
  const rows = getDb()
    .prepare(`SELECT source_id, name FROM source_content_pins WHERE kind = ?`)
    .all(opts.kind) as Array<{ source_id: string; name: string }>
  const del = getDb().prepare(
    `DELETE FROM source_content_pins WHERE source_id = ? AND kind = ? AND name = ?`,
  )
  for (const row of rows) {
    if (row.source_id === except) continue
    const stored = normalizeName(row.name)
    const storedShort = stored.includes(".") ? stored.slice(stored.lastIndexOf(".") + 1) : stored
    if (stored === name || stored === short || storedShort === name || storedShort === short) {
      del.run(row.source_id, opts.kind, row.name)
    }
  }
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

function pinVersion(map: Record<string, string> | undefined, name: string): string | undefined {
  if (!map) return undefined
  const direct = map[name]?.trim()
  if (direct) return direct
  const want = name.trim().toLowerCase()
  for (const [key, value] of Object.entries(map)) {
    if (key.trim().toLowerCase() === want && value.trim()) return value.trim()
  }
  return undefined
}

/**
 * Record versions the caller already loaded. Returns false when a selected name
 * has no version, so the caller can read the catalog for that kind.
 */
function pinKnownVersions(
  sourceId: string,
  kind: SourceContentKind,
  names: string[] | undefined,
  map: Record<string, string> | undefined,
  catalogRef: string | undefined,
): boolean {
  if (!names?.length) return true
  let complete = true
  for (const raw of names) {
    const name = (kind === "blueprint" ? blueprintShortName({ name: raw }) : raw).trim()
    if (!name) continue
    const version = pinVersion(map, name) || pinVersion(map, raw)
    if (!version) {
      complete = false
      continue
    }
    if (kind === "role" || kind === "collection") {
      clearOtherSourceContentPins({ exceptSourceId: sourceId, kind, name })
    }
    upsertSourceContentPin({ sourceId, kind, name, version, catalogRef })
  }
  return complete
}

/**
 * After a successful source install/re-sync, pin catalog tip versions so LUX can
 * detect later bumps even when Ludus omits installed versions.
 * Versions already shown in the UI are stored directly.
 */
export async function pinSourceInstallSelection(
  apiKey: string,
  sourceId: string,
  selection: SourceInstallSelection,
  versions?: SourceCatalogVersionPins,
): Promise<void> {
  const sid = sourceId.trim()
  if (!sid) return
  const catalogRef = versions?.catalogRef
  const blueprintsKnown = pinKnownVersions(sid, "blueprint", selection.blueprints, versions?.blueprints, catalogRef)
  const templatesKnown = pinKnownVersions(sid, "template", selection.templates, versions?.templates, catalogRef)
  const rolesKnown = pinKnownVersions(sid, "role", selection.localRoles, versions?.localRoles, catalogRef)
  const collectionsKnown = pinKnownVersions(
    sid,
    "collection",
    selection.localCollections,
    versions?.localCollections,
    catalogRef,
  )

  if (selection.blueprints?.length && !blueprintsKnown) {
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

  if (selection.templates?.length && !templatesKnown) {
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

  if (selection.localRoles?.length && !rolesKnown) {
    const { items, catalogRef } = await resolveSourceRoles(apiKey, sid)
    for (const name of selection.localRoles) {
      const version = findVersion(items, name)
      if (version) {
        clearOtherSourceContentPins({ exceptSourceId: sid, kind: "role", name: name.trim() })
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

  if (selection.localCollections?.length && !collectionsKnown) {
    const { items, catalogRef } = await resolveSourceCollections(apiKey, sid)
    for (const name of selection.localCollections) {
      const version = findVersion(items, name)
      if (version) {
        clearOtherSourceContentPins({
          exceptSourceId: sid,
          kind: "collection",
          name: name.trim(),
        })
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
