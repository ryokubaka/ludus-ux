import "server-only"
import { APP_VERSION } from "@/lib/changelog"
import {
  buildLuxReleasesSnapshot,
  type GithubReleaseInput,
  type LuxReleasesSnapshot,
} from "@/lib/lux-version"

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/ryokubaka/ludus-ux/releases?per_page=100"
const CACHE_TTL_MS = 60 * 60 * 1000

type CacheEntry = { at: number; raw: GithubReleaseInput[]; error?: string }

let cache: CacheEntry | null = null

export function clearLuxReleasesCache(): void {
  cache = null
}

async function fetchGithubReleases(): Promise<{ raw: GithubReleaseInput[]; error?: string }> {
  const ttl = cache?.error ? 60_000 : CACHE_TTL_MS
  if (cache && Date.now() - cache.at < ttl) {
    return { raw: cache.raw, error: cache.error }
  }

  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ludus-ux",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    })
    if (!res.ok) {
      const error = `GitHub releases returned HTTP ${res.status}`
      const raw = cache?.raw ?? []
      cache = { at: Date.now(), raw, error }
      return { raw, error }
    }
    const json: unknown = await res.json()
    const raw = Array.isArray(json) ? (json as GithubReleaseInput[]) : []
    cache = { at: Date.now(), raw }
    return { raw }
  } catch (err) {
    const error =
      err instanceof Error && err.name === "TimeoutError"
        ? "GitHub releases request timed out"
        : "Could not reach GitHub releases"
    const raw = cache?.raw ?? []
    cache = { at: Date.now(), raw, error }
    return { raw, error }
  }
}

export async function getLuxReleasesSnapshot(
  currentVersion = APP_VERSION,
): Promise<LuxReleasesSnapshot> {
  const { raw, error } = await fetchGithubReleases()
  const snap = buildLuxReleasesSnapshot(currentVersion, raw)
  return error ? { ...snap, error } : snap
}

export async function listKnownLuxReleaseTags(): Promise<string[]> {
  const snap = await getLuxReleasesSnapshot()
  return snap.releases.map((r) => r.tag)
}
