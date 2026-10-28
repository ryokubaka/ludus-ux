"use client"

export type SourceCatalogOrigin = "ludus" | "github"

export interface SourceCatalogResult<T> {
  items: T[]
  catalogSource?: SourceCatalogOrigin
  /** Git ref from the Sources tab registration used for git enrichment. */
  catalogRef?: string
  /** name (lower) → version pinned at last successful install/re-sync. */
  pins?: Record<string, string>
}

type SourceCatalogSegment = "blueprints" | "templates" | "roles" | "collections"

const RESPONSE_KEY: Record<SourceCatalogSegment, string> = {
  blueprints: "blueprints",
  templates: "templates",
  roles: "roles",
  collections: "collections",
}

function parsePins(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k.trim().toLowerCase()] = v.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Fetch a Ludus source catalog segment via LUX API (Ludus first, git fallback server-side). */
export async function fetchSourceCatalog<T>(
  sourceId: string,
  segment: SourceCatalogSegment,
): Promise<SourceCatalogResult<T>> {
  const res = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/${segment}`, {
    cache: "no-store",
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return {
    items: (data[RESPONSE_KEY[segment]] ?? []) as T[],
    catalogSource: data.catalogSource as SourceCatalogOrigin | undefined,
    catalogRef: typeof data.catalogRef === "string" ? data.catalogRef : undefined,
    pins: parsePins(data.pins),
  }
}

/** Normalize React Query cache payloads from older `{ roles }` / `{ collections }` shapes. */
export function sourceCatalogItems<T>(
  payload: { items?: T[]; roles?: T[]; collections?: T[]; blueprints?: T[]; templates?: T[] } | undefined,
): T[] {
  if (!payload) return []
  if (payload.items?.length) return payload.items
  return (
    payload.roles ??
    payload.collections ??
    payload.blueprints ??
    payload.templates ??
    []
  )
}
