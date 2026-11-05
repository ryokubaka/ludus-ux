/**
 * GitLab and GitHub repository APIs for listing and fetching Ludus template trees.
 */

import { safeRepoFetch } from "@/lib/templates/safe-template-repo-url"

export interface RepoTreeItem {
  name: string
  type: "tree" | "blob"
  path: string
}

interface GitLabTreeItem {
  name: string
  type: "tree" | "blob"
  path: string
}

interface GitHubContentItem {
  name: string
  path: string
  type: "dir" | "file"
}

interface GitHubTreeItem {
  path: string
  type: "blob" | "tree"
}

const FETCH_HEADERS = { "User-Agent": "ludus-ux/1.0", Accept: "application/vnd.github+json" }

/** Next.js caches `fetch` by default — source version pins must always hit the tip. */
const NO_STORE = { cache: "no-store" as const }

const GITHUB_API = "https://api.github.com"
const GITHUB_RAW = "https://raw.githubusercontent.com"
const GITHUB_ORIGINS: Record<string, string> = {
  "api.github.com": GITHUB_API,
  "raw.githubusercontent.com": GITHUB_RAW,
  "github.com": "https://github.com",
  "codeload.github.com": "https://codeload.github.com",
}

export interface GitHubRepo {
  owner: string
  repo: string
}

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** Constant GitHub host plus one encodeURIComponent per path and query segment. */
export function rebuildGitHubUrl(input: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null
  const origin = GITHUB_ORIGINS[parsed.hostname.toLowerCase()]
  if (!origin) return null
  const segments: string[] = []
  for (const segment of parsed.pathname.split("/")) {
    if (!segment) continue
    const decoded = decodePathSegment(segment)
    if (decoded == null) return null
    segments.push(encodeURIComponent(decoded))
  }
  const query = [...parsed.searchParams]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")
  return `${origin}/${segments.join("/")}${query ? `?${query}` : ""}`
}

/** User-supplied repo hosts are resolved and pinned. GitHub stays on normal fetch. */
function repoFetch(url: string, init?: RequestInit): Promise<Response> {
  const github = rebuildGitHubUrl(url)
  if (github) return fetch(github, init)
  return safeRepoFetch(url, init)
}

export function githubRepoFromApiBase(apiBase: string): GitHubRepo | null {
  let parsed: URL
  try {
    parsed = new URL(apiBase)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null
  if (parsed.hostname.toLowerCase() !== "api.github.com") return null
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts[0] !== "repos" || !parts[1] || !parts[2]) return null
  const owner = decodePathSegment(parts[1])
  const repo = decodePathSegment(parts[2])
  if (!owner || !repo) return null
  return { owner, repo }
}

export function isGitHubApiBase(apiBase: string): boolean {
  return githubRepoFromApiBase(apiBase) !== null
}

export function githubApiPath(repo: GitHubRepo, ...segments: string[]): string {
  const path = ["repos", repo.owner, repo.repo, ...segments].map((segment) => encodeURIComponent(segment)).join("/")
  return `${GITHUB_API}/${path}`
}

export function parseGitHubCloneUrl(gitUrl: string): GitHubRepo | null {
  let parsed: URL
  try {
    parsed = new URL(gitUrl.trim().replace(/\.git$/, ""))
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null
  if (parsed.hostname.toLowerCase() !== "github.com") return null
  const [owner, repo] = parsed.pathname.split("/").filter(Boolean)
  if (!owner || !repo) return null
  const decodedOwner = decodePathSegment(owner)
  const decodedRepo = decodePathSegment(repo)
  if (!decodedOwner || !decodedRepo) return null
  return { owner: decodedOwner, repo: decodedRepo }
}

/** Map a repository API base URL to a git clone URL for Ludus Sources registration. */
export function apiBaseToGitUrl(apiBase: string): string | null {
  const github = githubRepoFromApiBase(apiBase)
  if (github) {
    return `https://github.com/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}`
  }
  const gitlabMatch = /^(https:\/\/[^/]+)\/api\/v4\/projects\/(.+)$/.exec(apiBase.trim())
  if (gitlabMatch) {
    const project = decodeURIComponent(gitlabMatch[2])
    return `${gitlabMatch[1]}/${project}`
  }
  return null
}

/**
 * Map a git clone / browse URL to a GitHub or GitLab repository API base.
 * Used when listing/installing from a Ludus registered source URL.
 */
export function gitUrlToRepoApiBase(gitUrl: string): string | null {
  const normalized = gitUrl.trim().replace(/\.git$/, "").replace(/\/+$/, "")
  if (!normalized) return null

  const gh = parseGitHubCloneUrl(normalized)
  if (gh) return githubApiPath(gh)

  const glBrowse = normalized.match(
    /^(https:\/\/[^/]*gitlab[^/]*)\/([^/]+\/[^/]+?)(?:\/-\/.*)?$/i,
  )
  if (glBrowse) {
    return `${glBrowse[1]}/api/v4/projects/${encodeURIComponent(glBrowse[2])}/repository`
  }

  // Already an API base
  if (isGitHubApiBase(normalized) || /\/api\/v4\/projects\//.test(normalized)) {
    return normalized
  }

  return null
}

/** Raw file URL for GitHub repos (apiBase = https://api.github.com/repos/owner/repo). */
export function githubRawFileUrl(apiBase: string, path: string, ref: string): string {
  const repo = githubRepoFromApiBase(apiBase)
  if (!repo) throw new Error("Invalid GitHub apiBase")
  // Keep slashes in branch names (feat/securityonion-3.3.0). Callers that need a
  // fresh tip should pass a commit SHA; branch URLs are cached by GitHub.
  const encodedRef = ref.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  return `${GITHUB_RAW}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${encodedRef}/${encodedPath}`
}

const refShaCache = new Map<string, { sha: string; at: number }>()
const REF_SHA_TTL_MS = 15_000

/**
 * Resolve a branch/tag to a commit SHA before reading file contents.
 * raw.githubusercontent.com caches branch-tip URLs (max-age=300), so a push
 * can keep showing the previous meta/version.yml and blueprint.yml.
 */
export async function resolveGitHubCommitSha(apiBase: string, ref: string): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref
  const key = `${apiBase}\n${ref}`
  const hit = refShaCache.get(key)
  if (hit && Date.now() - hit.at < REF_SHA_TTL_MS) return hit.sha
  const repo = githubRepoFromApiBase(apiBase)
  if (!repo) throw new Error("Invalid GitHub apiBase")
  const res = await repoFetch(`${githubApiPath(repo, "commits", ref)}`, {
    headers: FETCH_HEADERS,
    ...NO_STORE,
  })
  if (!res.ok) throw new Error(`Could not resolve GitHub ref "${ref}" (HTTP ${res.status})`)
  const body = (await res.json()) as { sha?: string }
  const sha = body.sha?.trim()
  if (!sha) throw new Error(`GitHub ref "${ref}" did not return a commit sha`)
  refShaCache.set(key, { sha, at: Date.now() })
  return sha
}

export async function listRepoDirectory(
  apiBase: string,
  dirPath: string,
  ref: string,
): Promise<RepoTreeItem[]> {
  if (isGitHubApiBase(apiBase)) {
    const repo = githubRepoFromApiBase(apiBase)
    if (!repo) throw new Error("Invalid GitHub apiBase")
    const segments = dirPath.split("/").filter(Boolean)
    const url = `${githubApiPath(repo, "contents", ...segments)}?ref=${encodeURIComponent(ref)}`
    const res = await repoFetch(url, { headers: FETCH_HEADERS, ...NO_STORE })
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`)
    const items = (await res.json()) as GitHubContentItem | GitHubContentItem[]
    const list = Array.isArray(items) ? items : [items]
    return list.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type === "dir" ? "tree" : "blob",
    }))
  }

  const url = `${apiBase}/tree?path=${encodeURIComponent(dirPath)}&ref=${encodeURIComponent(ref)}&per_page=100`
  const res = await repoFetch(url, { headers: { "User-Agent": "ludus-ux/1.0" }, ...NO_STORE })
  if (!res.ok) throw new Error(`GitLab API ${res.status} for ${url}`)
  const items = (await res.json()) as GitLabTreeItem[]
  return items.map((item) => ({ name: item.name, path: item.path, type: item.type }))
}

/** Collect all blobs under a path recursively. */
export async function fetchAllRepoBlobs(
  apiBase: string,
  path: string,
  ref: string,
): Promise<RepoTreeItem[]> {
  if (isGitHubApiBase(apiBase)) {
    const repo = githubRepoFromApiBase(apiBase)
    if (!repo) throw new Error("Invalid GitHub apiBase")
    const commitRes = await repoFetch(`${githubApiPath(repo, "commits", ref)}`, {
      headers: FETCH_HEADERS,
      ...NO_STORE,
    })
    if (!commitRes.ok) {
      throw new Error(`Could not resolve GitHub ref "${ref}" (HTTP ${commitRes.status})`)
    }
    const commit = (await commitRes.json()) as { commit: { tree: { sha: string } } }
    const treeSha = commit.commit.tree.sha

    const treeRes = await repoFetch(`${githubApiPath(repo, "git", "trees", treeSha)}?recursive=1`, {
      headers: FETCH_HEADERS,
      ...NO_STORE,
    })
    if (!treeRes.ok) throw new Error(`Could not list GitHub tree (HTTP ${treeRes.status})`)
    const treeData = (await treeRes.json()) as { tree: GitHubTreeItem[] }

    const prefix = path.endsWith("/") ? path : `${path}/`
    return treeData.tree
      .filter((item) => item.type === "blob" && (item.path.startsWith(prefix) || item.path === path))
      .map((item) => ({
        name: item.path.split("/").pop() ?? item.path,
        type: "blob" as const,
        path: item.path,
      }))
  }

  const blobs: RepoTreeItem[] = []
  let page = 1
  while (true) {
    const url =
      `${apiBase}/tree?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}` +
      `&per_page=100&recursive=true&page=${page}`
    const res = await repoFetch(url, { headers: { "User-Agent": "ludus-ux/1.0" }, ...NO_STORE })
    if (!res.ok) throw new Error(`Could not list template tree (HTTP ${res.status})`)
    const items = (await res.json()) as GitLabTreeItem[]
    blobs.push(...items.filter((item) => item.type === "blob"))
    if (items.length < 100) break
    page++
  }
  return blobs
}

export async function fetchRepoRawFile(apiBase: string, path: string, ref: string): Promise<string> {
  if (isGitHubApiBase(apiBase)) {
    let sha = ref
    try {
      sha = await resolveGitHubCommitSha(apiBase, ref)
    } catch {
      sha = ref
    }
    const url = githubRawFileUrl(apiBase, path, sha)
    const res = await repoFetch(url, { headers: { "User-Agent": "ludus-ux/1.0" }, ...NO_STORE })
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`)
    return res.text()
  }
  const url = `${apiBase}/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`
  const res = await repoFetch(url, { headers: { "User-Agent": "ludus-ux/1.0" }, ...NO_STORE })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`)
  return res.text()
}

export type RepoRefKind = "branch" | "tag"

export interface RepoRef {
  name: string
  kind: RepoRefKind
}

/** List remote branches (and optionally tags) for a GitHub/GitLab clone URL. */
export async function listRepoRefs(
  gitUrl: string,
  opts?: { includeTags?: boolean },
): Promise<RepoRef[]> {
  const apiBase = gitUrlToRepoApiBase(gitUrl)
  if (!apiBase) {
    throw new Error("Unsupported git host — only GitHub and GitLab URLs are supported")
  }

  const refs: RepoRef[] = []

  if (isGitHubApiBase(apiBase)) {
    const repo = githubRepoFromApiBase(apiBase)
    if (!repo) throw new Error("Invalid GitHub apiBase")
    let page = 1
    while (page <= 10) {
      const url = `${githubApiPath(repo, "branches")}?per_page=100&page=${encodeURIComponent(String(page))}`
      const res = await repoFetch(url, { headers: FETCH_HEADERS, ...NO_STORE })
      if (!res.ok) throw new Error(`GitHub branches API ${res.status}`)
      const rows = (await res.json()) as Array<{ name?: string }>
      for (const row of rows) {
        if (row.name?.trim()) refs.push({ name: row.name.trim(), kind: "branch" })
      }
      if (rows.length < 100) break
      page += 1
    }
    if (opts?.includeTags) {
      let tagPage = 1
      while (tagPage <= 5) {
        const url = `${githubApiPath(repo, "tags")}?per_page=100&page=${encodeURIComponent(String(tagPage))}`
        const res = await repoFetch(url, { headers: FETCH_HEADERS, ...NO_STORE })
        if (!res.ok) break
        const rows = (await res.json()) as Array<{ name?: string }>
        for (const row of rows) {
          if (row.name?.trim()) refs.push({ name: row.name.trim(), kind: "tag" })
        }
        if (rows.length < 100) break
        tagPage += 1
      }
    }
  } else {
    // GitLab: apiBase ends with …/repository
    let page = 1
    while (page <= 10) {
      const url = `${apiBase}/branches?per_page=100&page=${page}`
      const res = await repoFetch(url, { headers: { "User-Agent": "ludus-ux/1.0" }, ...NO_STORE })
      if (!res.ok) throw new Error(`GitLab branches API ${res.status}`)
      const rows = (await res.json()) as Array<{ name?: string }>
      for (const row of rows) {
        if (row.name?.trim()) refs.push({ name: row.name.trim(), kind: "branch" })
      }
      if (rows.length < 100) break
      page += 1
    }
    if (opts?.includeTags) {
      let tagPage = 1
      while (tagPage <= 5) {
        const url = `${apiBase}/tags?per_page=100&page=${tagPage}`
        const res = await repoFetch(url, { headers: { "User-Agent": "ludus-ux/1.0" }, ...NO_STORE })
        if (!res.ok) break
        const rows = (await res.json()) as Array<{ name?: string }>
        for (const row of rows) {
          if (row.name?.trim()) refs.push({ name: row.name.trim(), kind: "tag" })
        }
        if (rows.length < 100) break
        tagPage += 1
      }
    }
  }

  refs.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "branch" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return refs
}
