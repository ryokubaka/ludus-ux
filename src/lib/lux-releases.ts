import "server-only"
import { APP_VERSION } from "@/lib/changelog"
import {
  buildLuxReleasesSnapshot,
  githubMatchingHeadNames,
  type GithubReleaseInput,
  type LuxReleasesSnapshot,
} from "@/lib/lux-version"

const GITHUB_REPO = "ryokubaka/ludus-ux"
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}`
const GITHUB_RELEASES_URL = `${GITHUB_API}/releases?per_page=100`
/** Prefix match: only heads named v… — version branches, not main or topic branches. */
const GITHUB_VERSION_HEADS_URL = `${GITHUB_API}/git/matching-refs/heads/v?per_page=100`
const GITHUB_BRANCH_WEB = `https://github.com/${GITHUB_REPO}/tree`
const CACHE_TTL_MS = 60 * 60 * 1000
const BRANCH_PAGE_CAP = 5

type CacheEntry = {
  at: number
  raw: GithubReleaseInput[]
  branches: { name: string; html_url: string }[]
  error?: string
  branchesError?: string
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

function nextPageUrl(res: Response): string | null {
  const link = res.headers.get("link")
  if (!link) return null
  const part = link.split(",").find((entry) => entry.includes('rel="next"'))
  return part?.match(/<([^>]+)>/)?.[1] ?? null
}

async function fetchGithubReleases(): Promise<{ raw: GithubReleaseInput[]; error?: string }> {
  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    })
    if (!res.ok) {
      return { raw: cache?.raw ?? [], error: `GitHub releases returned HTTP ${res.status}` }
    }
    const json: unknown = await res.json()
    const raw = Array.isArray(json) ? (json as GithubReleaseInput[]) : []
    return { raw }
  } catch (err) {
    const error =
      err instanceof Error && err.name === "TimeoutError"
        ? "GitHub releases request timed out"
        : "Could not reach GitHub releases"
    return { raw: cache?.raw ?? [], error }
  }
}

async function fetchVersionBranches(): Promise<{
  branches: { name: string; html_url: string }[]
  error?: string
}> {
  try {
    const names: string[] = []
    let url: string | null = GITHUB_VERSION_HEADS_URL
    for (let page = 0; url && page < BRANCH_PAGE_CAP; page++) {
      const res = await fetch(url, {
        headers: githubHeaders(),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      })
      // No heads with this prefix.
      if (res.status === 404) return { branches: [] }
      if (!res.ok) {
        return {
          branches: cache?.branches ?? [],
          error: `GitHub branches returned HTTP ${res.status}`,
        }
      }
      const json: unknown = await res.json()
      names.push(...githubMatchingHeadNames(json))
      url = nextPageUrl(res)
    }
    const branches = [...new Set(names)].map((name) => ({
      name,
      html_url: `${GITHUB_BRANCH_WEB}/${encodeURIComponent(name)}`,
    }))
    return { branches }
  } catch (err) {
    const error =
      err instanceof Error && err.name === "TimeoutError"
        ? "GitHub branches request timed out"
        : "Could not list unpublished release branches"
    return { branches: cache?.branches ?? [], error }
  }
}

async function fetchGithubReleaseCatalog(): Promise<CacheEntry> {
  const failed = Boolean(cache?.error || cache?.branchesError)
  const ttl = failed ? 60_000 : CACHE_TTL_MS
  if (cache && Date.now() - cache.at < ttl) return cache

  const [releases, branches] = await Promise.all([fetchGithubReleases(), fetchVersionBranches()])
  cache = {
    at: Date.now(),
    raw: releases.raw,
    branches: branches.branches,
    error: releases.error,
    branchesError: branches.error,
  }
  return cache
}

export async function getLuxReleasesSnapshot(
  currentVersion = APP_VERSION,
): Promise<LuxReleasesSnapshot> {
  const { raw, branches, error, branchesError } = await fetchGithubReleaseCatalog()
  const snap = buildLuxReleasesSnapshot(currentVersion, raw, branches)
  const note = [error, branchesError].filter(Boolean).join(" ")
  return note ? { ...snap, error: note } : snap
}

export async function listKnownLuxReleaseTags(): Promise<string[]> {
  const snap = await getLuxReleasesSnapshot()
  return snap.releases.map((r) => r.tag)
}
