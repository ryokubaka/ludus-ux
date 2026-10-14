import "server-only"
import { APP_VERSION } from "@/lib/changelog"
import {
  parseLuxGitRemote,
  snapshotFromGitRefs,
  type GithubReleaseInput,
  type LuxReleasesSnapshot,
} from "@/lib/lux-version"

const CACHE_TTL_MS = 60 * 60 * 1000

type CacheEntry = {
  at: number
  url: string
  heads: string[]
  tags: string[]
  github: GithubReleaseInput[]
  error?: string
}

let cache: CacheEntry | null = null

export function clearLuxReleasesCache(): void {
  cache = null
}

function githubHeaders(): HeadersInit {
  const ghToken = (process.env.GITHUB_TOKEN || process.env.LUX_GITHUB_TOKEN || "").trim()
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "ludus-ux",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(ghToken ? { Authorization: `Bearer ${ghToken}` } : {}),
  }
}

/** Notes and dates for a GitHub remote. A failure leaves the git list intact. */
async function fetchGithubReleaseNotes(repo: string): Promise<GithubReleaseInput[]> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return []
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    })
    if (!res.ok) return []
    const json: unknown = await res.json()
    return Array.isArray(json) ? (json as GithubReleaseInput[]) : []
  } catch {
    return []
  }
}

async function loadOriginCatalog(): Promise<CacheEntry> {
  const ttl = cache?.error ? 60_000 : CACHE_TTL_MS
  if (cache && Date.now() - cache.at < ttl) return cache

  // lux-upgrade-run imports getLuxReleasesSnapshot from this module.
  const { readLuxOriginReleaseRefs } = await import("@/lib/lux-upgrade-run")
  const origin = await readLuxOriginReleaseRefs()
  const remote = origin.url ? parseLuxGitRemote(origin.url) : null
  const github = !origin.error && remote?.githubRepo
    ? await fetchGithubReleaseNotes(remote.githubRepo)
    : []
  cache = {
    at: Date.now(),
    url: origin.url,
    heads: origin.heads,
    tags: origin.tags,
    github,
    error: origin.error,
  }
  return cache
}

export async function getLuxReleasesSnapshot(
  currentVersion = APP_VERSION,
): Promise<LuxReleasesSnapshot> {
  const { url, heads, tags, github, error } = await loadOriginCatalog()
  const snap = snapshotFromGitRefs(currentVersion, url, heads, tags, github)
  return error ? { ...snap, error } : snap
}
