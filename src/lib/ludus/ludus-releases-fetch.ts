import "server-only"

import { ludusRequest } from "@/lib/ludus/ludus-client"
import { extractLudusVersionString } from "@/lib/ludus/ludus-router-template"
import {
  LUDUS_GITLAB_PROJECT_ID,
  buildLudusReleasesSnapshot,
  releasesFromGitlab,
  type LudusGitlabRelease,
  type LudusReleasesSnapshot,
} from "@/lib/ludus/ludus-releases"

const CACHE_TTL_MS = 10 * 60 * 1000
const ERROR_TTL_MS = 60 * 1000

type CacheEntry = {
  at: number
  rows: LudusGitlabRelease[]
  error?: string
}

let cache: CacheEntry | null = null

export function clearLudusReleasesCache(): void {
  cache = null
}

async function fetchGitlab(path: string): Promise<unknown | null> {
  const res = await fetch(
    `https://gitlab.com/api/v4/projects/${LUDUS_GITLAB_PROJECT_ID}${path}`,
    {
      headers: { Accept: "application/json", "User-Agent": "ludus-ux" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    },
  )
  if (!res.ok) return null
  return res.json() as Promise<unknown>
}

async function loadGitlabReleases(): Promise<CacheEntry> {
  const ttl = cache?.error ? ERROR_TTL_MS : CACHE_TTL_MS
  if (cache && Date.now() - cache.at < ttl) return cache
  try {
    const releases = await fetchGitlab("/releases?per_page=20")
    let rows = releasesFromGitlab(releases)
    if (rows.length === 0) {
      const tags = await fetchGitlab("/repository/tags?per_page=20")
      rows = releasesFromGitlab(tags)
    }
    cache = {
      at: Date.now(),
      rows,
      ...(rows.length === 0 ? { error: "Could not read Ludus releases from GitLab." } : {}),
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "request failed"
    console.warn(`[ludus-releases] ${detail}`)
    cache = { at: Date.now(), rows: [], error: "Could not reach GitLab for Ludus releases." }
  }
  return cache
}

export async function getLudusReleasesSnapshot(apiKey: string): Promise<LudusReleasesSnapshot> {
  const [catalog, version] = await Promise.all([
    loadGitlabReleases(),
    ludusRequest<unknown>("/", { apiKey }).catch(() => null),
  ])
  const current = version && !version.error ? extractLudusVersionString(version.data) : ""
  return buildLudusReleasesSnapshot(current, catalog.rows, catalog.error)
}
