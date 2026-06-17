import {
  parseGalaxyRoleHits,
  type GalaxySearchHit,
} from "@/lib/ansible-galaxy-search"

const GALAXY_ORIGIN = "https://galaxy.ansible.com"
const GALAXY_HEADERS = { Accept: "application/json", "User-Agent": "ludus-ux/1.0" }
const MAX_COLLECTION_RESULTS = 20
const VERSION_FETCH_CONCURRENCY = 6

interface CollectionIndexItem {
  namespace: string
  name: string
  download_count?: number
  highest_version?: { version?: string }
}

interface Paginated<T> {
  meta?: { count?: number }
  data?: T[]
}

/** Parse `namespace.name` artifact id from a Galaxy search query. */
export function parseArtifactFqcn(query: string): { namespace: string; name: string } | null {
  const trimmed = query.trim()
  const match = /^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)$/.exec(trimmed)
  if (!match) return null
  return { namespace: match[1], name: match[2] }
}

async function galaxyGet<T>(path: string): Promise<T | null> {
  const url = path.startsWith("http") ? path : `${GALAXY_ORIGIN}${path}`
  const res = await fetch(url, { headers: GALAXY_HEADERS, cache: "no-store" })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Galaxy request failed (HTTP ${res.status})`)
  return (await res.json()) as T
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
  return results
}

async function fetchCollectionIndex(
  namespace: string,
  name: string,
): Promise<CollectionIndexItem | null> {
  return galaxyGet<CollectionIndexItem>(
    `/api/v3/plugin/ansible/content/published/collections/index/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/`,
  )
}

async function listCollectionIndex(
  params: Record<string, string>,
  limit: number,
): Promise<CollectionIndexItem[]> {
  const url = new URL(
    `${GALAXY_ORIGIN}/api/v3/plugin/ansible/content/published/collections/index/`,
  )
  url.searchParams.set("limit", String(limit))
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const data = await galaxyGet<Paginated<CollectionIndexItem>>(url.toString())
  return data?.data ?? []
}

/** All published versions for a collection (newest first in API; caller sorts when grouping). */
export async function fetchAllCollectionVersions(
  namespace: string,
  name: string,
): Promise<string[]> {
  const versions: string[] = []
  let offset = 0
  const limit = 100
  while (true) {
    const path =
      `/api/v3/plugin/ansible/content/published/collections/index/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/versions/?limit=${limit}&offset=${offset}`
    const page = await galaxyGet<Paginated<{ version?: string }>>(path)
    const rows = page?.data ?? []
    if (rows.length === 0) break
    for (const row of rows) {
      if (row.version) versions.push(row.version)
    }
    offset += rows.length
    const total = page?.meta?.count ?? offset
    if (offset >= total) break
  }
  return versions
}

async function discoverCollectionsFromVersionSearch(
  keywords: string,
  maxCollections: number,
): Promise<CollectionIndexItem[]> {
  const url = new URL(`${GALAXY_ORIGIN}/api/v3/plugin/ansible/search/collection-versions/`)
  url.searchParams.set("keywords", keywords)
  url.searchParams.set("limit", "100")
  url.searchParams.set("offset", "0")

  const data = await galaxyGet<{
    data?: Array<{
      download_count?: number
      collection_version?: {
        namespace?: string
        name?: string
        version?: string
        description?: string
      }
    }>
  }>(url.toString())

  const byFqcn = new Map<string, CollectionIndexItem>()
  for (const row of data?.data ?? []) {
    const cv = row.collection_version
    const ns = cv?.namespace
    const name = cv?.name
    if (!ns || !name) continue
    const fqcn = `${ns}.${name}`
    const existing = byFqcn.get(fqcn)
    const downloadCount = row.download_count ?? existing?.download_count ?? 0
    if (!existing || (downloadCount > (existing.download_count ?? 0))) {
      byFqcn.set(fqcn, {
        namespace: ns,
        name,
        download_count: downloadCount,
        highest_version: cv.version ? { version: cv.version } : existing?.highest_version,
      })
    }
  }

  return [...byFqcn.values()]
    .sort((a, b) => (b.download_count ?? 0) - (a.download_count ?? 0))
    .slice(0, maxCollections)
}

function collectionToHits(
  item: CollectionIndexItem,
  versions: string[],
  description?: string,
): GalaxySearchHit[] {
  const fqcn = `${item.namespace}.${item.name}`
  if (versions.length === 0) {
    const fallbackVersion = item.highest_version?.version
    return [
      {
        name: fqcn,
        version: fallbackVersion,
        type: "collection",
        description,
        downloadCount: item.download_count,
      },
    ]
  }
  return versions.map((version) => ({
    name: fqcn,
    version,
    type: "collection",
    description,
    downloadCount: item.download_count,
  }))
}

async function hydrateCollectionHits(candidates: CollectionIndexItem[]): Promise<GalaxySearchHit[]> {
  const limited = candidates.slice(0, MAX_COLLECTION_RESULTS)
  const hitGroups = await mapConcurrent(limited, VERSION_FETCH_CONCURRENCY, async (item) =>
    collectionToHits(item, await fetchAllCollectionVersions(item.namespace, item.name)),
  )
  return hitGroups.flat()
}

async function lookupCollectionFqcn(
  namespace: string,
  name: string,
): Promise<GalaxySearchHit[]> {
  const detail = await fetchCollectionIndex(namespace, name)
  if (!detail) return []
  const versions = await fetchAllCollectionVersions(namespace, name)
  return collectionToHits(detail, versions)
}

export async function searchGalaxyCollections(query: string): Promise<GalaxySearchHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const fqcn = parseArtifactFqcn(q)
  if (fqcn) {
    const hits = await lookupCollectionFqcn(fqcn.namespace, fqcn.name)
    if (hits.length > 0) return hits
  }

  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length === 2) {
    const hits = await lookupCollectionFqcn(tokens[0]!, tokens[1]!)
    if (hits.length > 0) return hits
  }

  let candidates: CollectionIndexItem[] = []
  if (!q.includes(".") && !q.includes(" ") && /^[a-zA-Z0-9_]+$/.test(q)) {
    candidates = await listCollectionIndex({ name: q }, MAX_COLLECTION_RESULTS)
    candidates.sort((a, b) => (b.download_count ?? 0) - (a.download_count ?? 0))
  }

  if (candidates.length === 0) {
    const keywords = q.replace(/\./g, " ")
    candidates = await discoverCollectionsFromVersionSearch(keywords, MAX_COLLECTION_RESULTS)
  }

  return hydrateCollectionHits(candidates)
}

async function lookupRoleFqcn(namespace: string, name: string): Promise<GalaxySearchHit[]> {
  const url = new URL(`${GALAXY_ORIGIN}/api/v1/roles/`)
  url.searchParams.set("owner__username", namespace)
  url.searchParams.set("name", name)

  const data = await galaxyGet<{ results?: Array<{ id?: number; summary?: string; description?: string; download_count?: number }> }>(
    url.toString(),
  )
  const role = data?.results?.[0]
  if (!role?.id) return []

  const versionsData = await galaxyGet<{ results?: Array<{ name?: string }> }>(
    `/api/v1/roles/${role.id}/versions/`,
  )
  const versions = (versionsData?.results ?? [])
    .map((v) => v.name)
    .filter((v): v is string => Boolean(v))

  const fqcn = `${namespace}.${name}`
  const description = role.summary ?? role.description
  if (versions.length === 0) {
    return [{ name: fqcn, type: "role", description, downloadCount: role.download_count }]
  }
  return versions.map((version) => ({
    name: fqcn,
    version,
    type: "role",
    description,
    downloadCount: role.download_count,
  }))
}

export async function searchGalaxyRoles(query: string): Promise<GalaxySearchHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const fqcn = parseArtifactFqcn(q)
  if (fqcn) {
    const hits = await lookupRoleFqcn(fqcn.namespace, fqcn.name)
    if (hits.length > 0) return hits
  }

  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length === 2) {
    const hits = await lookupRoleFqcn(tokens[0]!, tokens[1]!)
    if (hits.length > 0) return hits
  }

  const url = new URL(`${GALAXY_ORIGIN}/api/v1/search/roles/`)
  url.searchParams.set("keywords", q.replace(/\./g, " "))
  url.searchParams.set("page_size", "25")
  url.searchParams.set("order_by", "-download_count")

  const data = await galaxyGet<{ results?: Parameters<typeof parseGalaxyRoleHits>[0] }>(
    url.toString(),
  )
  const searchHits = parseGalaxyRoleHits(data?.results ?? [])

  const byName = new Map<string, GalaxySearchHit[]>()
  for (const hit of searchHits) {
    const list = byName.get(hit.name) ?? []
    list.push(hit)
    byName.set(hit.name, list)
  }

  const hydrated = await mapConcurrent([...byName.entries()], VERSION_FETCH_CONCURRENCY, async ([name, hits]) => {
    if (hits.some((h) => h.version)) return hits
    const [namespace, roleName] = name.split(".")
    if (!namespace || !roleName) return hits
    const full = await lookupRoleFqcn(namespace, roleName)
    return full.length > 0 ? full : hits
  })

  return hydrated.flat()
}
