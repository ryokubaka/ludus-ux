export interface GalaxySearchHit {
  name: string
  version?: string
  type: "role" | "collection"
  description?: string
  downloadCount?: number
}

export interface GalaxySearchGroup {
  name: string
  type: "role" | "collection"
  description?: string
  /** Semver-sorted, newest first. */
  versions: string[]
}

function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.+_-]/)
    .map((part) => {
      const n = Number.parseInt(part, 10)
      return Number.isFinite(n) ? n : 0
    })
}

/** Sort Galaxy version strings newest → oldest. */
export function compareGalaxyVersionDesc(a: string, b: string): number {
  const pa = parseVersionParts(a)
  const pb = parseVersionParts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return b.localeCompare(a)
}

/** Collapse flat search hits into one row per artifact with all versions. */
export function groupGalaxySearchHits(hits: GalaxySearchHit[]): GalaxySearchGroup[] {
  const byName = new Map<string, GalaxySearchGroup>()
  for (const hit of hits) {
    const existing = byName.get(hit.name)
    if (existing) {
      if (hit.version && !existing.versions.includes(hit.version)) {
        existing.versions.push(hit.version)
      }
      if (!existing.description && hit.description) existing.description = hit.description
      continue
    }
    byName.set(hit.name, {
      name: hit.name,
      type: hit.type,
      description: hit.description,
      versions: hit.version ? [hit.version] : [],
    })
  }
  const groups = [...byName.values()]
  for (const group of groups) {
    group.versions.sort(compareGalaxyVersionDesc)
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name))
}

interface GalaxyRoleHit {
  name?: string
  username?: string
  summary?: string
  description?: string
  download_count?: number
  namespace?: { name?: string }
  summary_fields?: {
    namespace?: { name?: string }
    versions?: Array<{ name?: string }>
  }
  versions?: Array<{ name?: string }>
}

interface GalaxyCollectionSearchItem {
  collection_version?: {
    namespace?: string
    name?: string
    version?: string
    description?: string
  }
  namespace?: string
  name?: string
  description?: string
  download_count?: number
  latest_version?: { version?: string }
}

export function parseGalaxyRoleHits(results: GalaxyRoleHit[]): GalaxySearchHit[] {
  const out: GalaxySearchHit[] = []
  for (const r of results) {
    const ns =
      r.summary_fields?.namespace?.name ??
      r.username ??
      r.namespace?.name ??
      ""
    const role = r.name ?? ""
    if (!ns || !role) continue
    const versions = (r.summary_fields?.versions ?? r.versions ?? [])
      .map((v) => v.name)
      .filter((v): v is string => Boolean(v))
    if (versions.length === 0) {
      out.push({
        name: `${ns}.${role}`,
        type: "role",
        description: r.summary ?? r.description,
        downloadCount: r.download_count,
      })
      continue
    }
    for (const version of versions) {
      out.push({
        name: `${ns}.${role}`,
        version,
        type: "role",
        description: r.summary ?? r.description,
        downloadCount: r.download_count,
      })
    }
  }
  return out
}

export function parseGalaxyCollectionHits(data: GalaxyCollectionSearchItem[]): GalaxySearchHit[] {
  const out: GalaxySearchHit[] = []
  for (const item of data) {
    const cv = item.collection_version
    const ns = cv?.namespace ?? item.namespace
    const name = cv?.name ?? item.name
    if (!ns || !name) continue
    out.push({
      name: `${ns}.${name}`,
      version: cv?.version ?? item.latest_version?.version,
      type: "collection",
      description: cv?.description ?? item.description,
      downloadCount: item.download_count,
    })
  }
  return out
}
