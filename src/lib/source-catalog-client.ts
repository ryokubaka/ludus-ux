"use client"

export type SourceCatalogOrigin = "ludus" | "github"

export interface SourceCatalogResult<T> {
  items: T[]
  catalogSource?: SourceCatalogOrigin
}

type SourceCatalogSegment = "blueprints" | "templates" | "roles" | "collections"

const RESPONSE_KEY: Record<SourceCatalogSegment, string> = {
  blueprints: "blueprints",
  templates: "templates",
  roles: "roles",
  collections: "collections",
}

/** Fetch a Ludus source catalog segment via LUX API (Ludus first, git fallback server-side). */
export async function fetchSourceCatalog<T>(
  sourceId: string,
  segment: SourceCatalogSegment,
): Promise<SourceCatalogResult<T>> {
  const res = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/${segment}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return {
    items: (data[RESPONSE_KEY[segment]] ?? []) as T[],
    catalogSource: data.catalogSource as SourceCatalogOrigin | undefined,
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
