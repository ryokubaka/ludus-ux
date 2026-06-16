/**
 * GitLab and GitHub repository APIs for listing and fetching Ludus template trees.
 */

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

export function isGitHubApiBase(apiBase: string): boolean {
  return apiBase.includes("api.github.com/repos/")
}

/** Raw file URL for GitHub repos (apiBase = https://api.github.com/repos/owner/repo). */
export function githubRawFileUrl(apiBase: string, path: string, ref: string): string {
  const match = /api\.github\.com\/repos\/([^/]+\/[^/]+)/.exec(apiBase)
  if (!match) throw new Error("Invalid GitHub apiBase")
  return `https://raw.githubusercontent.com/${match[1]}/${ref}/${path}`
}

export async function listRepoDirectory(
  apiBase: string,
  dirPath: string,
  ref: string,
): Promise<RepoTreeItem[]> {
  if (isGitHubApiBase(apiBase)) {
    const segment = dirPath
      ? `/${dirPath.split("/").map(encodeURIComponent).join("/")}`
      : ""
    const url = `${apiBase}/contents${segment}?ref=${encodeURIComponent(ref)}`
    const res = await fetch(url, { headers: FETCH_HEADERS })
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
  const res = await fetch(url, { headers: { "User-Agent": "ludus-ux/1.0" } })
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
    const commitRes = await fetch(`${apiBase}/commits/${encodeURIComponent(ref)}`, {
      headers: FETCH_HEADERS,
    })
    if (!commitRes.ok) {
      throw new Error(`Could not resolve GitHub ref "${ref}" (HTTP ${commitRes.status})`)
    }
    const commit = (await commitRes.json()) as { commit: { tree: { sha: string } } }
    const treeSha = commit.commit.tree.sha

    const treeRes = await fetch(`${apiBase}/git/trees/${treeSha}?recursive=1`, {
      headers: FETCH_HEADERS,
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
    const res = await fetch(url, { headers: { "User-Agent": "ludus-ux/1.0" } })
    if (!res.ok) throw new Error(`Could not list template tree (HTTP ${res.status})`)
    const items = (await res.json()) as GitLabTreeItem[]
    blobs.push(...items.filter((item) => item.type === "blob"))
    if (items.length < 100) break
    page++
  }
  return blobs
}

export async function fetchRepoRawFile(apiBase: string, path: string, ref: string): Promise<string> {
  const url = isGitHubApiBase(apiBase)
    ? githubRawFileUrl(apiBase, path, ref)
    : `${apiBase}/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`
  const res = await fetch(url, { headers: { "User-Agent": "ludus-ux/1.0" } })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`)
  return res.text()
}
