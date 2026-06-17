import "server-only"

import yaml from "js-yaml"
import { parseGalaxyCollectionFqcn } from "@/lib/ansible-collection-fqcn"
import {
  githubRawFileUrl,
  listRepoDirectory,
  fetchRepoRawFile,
  type RepoTreeItem,
} from "@/lib/template-repo-client"
import { sourceBlueprintInstallId } from "@/lib/registered-ludus-sources"

const GITHUB_FETCH_HEADERS = { "User-Agent": "ludus-ux/1.0", Accept: "application/vnd.github+json" }

interface GitHubContentEntry {
  git_url?: string
}

/** Git submodule entries appear as blobs under ansible/roles|collections. */
export function gitCatalogEntryNames(items: RepoTreeItem[], dirPath: string): string[] {
  const ansiblePath = dirPath.startsWith("ansible/")
  return items
    .filter((i) => i.type === "tree" || (ansiblePath && i.type === "blob"))
    .map((i) => i.name)
}

export function gitUrlToGithubApiBase(gitUrl: string): string | null {
  const normalized = gitUrl.trim().replace(/\.git$/, "")
  const m = normalized.match(/github\.com\/([^/]+\/[^/]+)/i)
  if (!m) return null
  return `https://api.github.com/repos/${m[1]}`
}

async function fetchGalaxyFqcnFromRepo(repo: string, ref: string): Promise<string | null> {
  for (const branch of [ref, "main", "master"]) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/galaxy.yml`, {
        headers: GITHUB_FETCH_HEADERS,
      })
      if (!res.ok) continue
      return parseGalaxyCollectionFqcn(await res.text())
    } catch {
      continue
    }
  }
  return null
}

/** Ludus install expects collection FQCN (namespace.name), not git submodule dir names. */
export async function resolveGitCollectionFqcn(
  apiBase: string,
  ref: string,
  dirName: string,
): Promise<string> {
  try {
    const rawUrl = githubRawFileUrl(apiBase, `ansible/collections/${dirName}/galaxy.yml`, ref)
    const res = await fetch(rawUrl, { headers: GITHUB_FETCH_HEADERS })
    if (res.ok) {
      const fqcn = parseGalaxyCollectionFqcn(await res.text())
      if (fqcn) return fqcn
    }
  } catch {
    /* inline collection or fetch failure */
  }

  try {
    const url = `${apiBase}/contents/ansible/collections/${encodeURIComponent(dirName)}?ref=${encodeURIComponent(ref || "main")}`
    const res = await fetch(url, { headers: GITHUB_FETCH_HEADERS })
    if (res.ok) {
      const item = (await res.json()) as GitHubContentEntry
      const repo = item.git_url?.match(/repos\/([^/]+\/[^/]+)\/git/)?.[1]
      if (repo) {
        const fqcn = await fetchGalaxyFqcnFromRepo(repo, ref || "main")
        if (fqcn) return fqcn
      }
    }
  } catch {
    /* submodule lookup failure */
  }

  return dirName
}

async function listGitSubdirs(gitUrl: string, ref: string, dirPath: string): Promise<string[]> {
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  if (!apiBase) return []
  try {
    const tree = await listRepoDirectory(apiBase, dirPath, ref || "main")
    return gitCatalogEntryNames(tree, dirPath)
  } catch {
    return []
  }
}

export async function listGitSourceBlueprints(
  gitUrl: string,
  ref: string,
  sourceID: string,
): Promise<Array<{ name: string; sourceBlueprintID: string }>> {
  const names = await listGitSubdirs(gitUrl, ref, "blueprints")
  return names.map((name) => ({
    name,
    sourceBlueprintID: sourceBlueprintInstallId({ name }, sourceID),
  }))
}

export interface GitBlueprintManifest {
  id?: string
  title?: string
  description?: string
  version?: string
  min_ludus_version?: string
}

export async function fetchGitBlueprintManifest(
  apiBase: string,
  ref: string,
  folderName: string,
): Promise<GitBlueprintManifest | null> {
  try {
    const raw = await fetchRepoRawFile(apiBase, `blueprints/${folderName}/blueprint.yml`, ref)
    const manifest = yaml.load(raw) as Record<string, unknown>
    return {
      id: typeof manifest.id === "string" ? manifest.id : folderName,
      title: typeof manifest.name === "string" ? manifest.name : undefined,
      description: typeof manifest.description === "string" ? manifest.description : undefined,
      version: typeof manifest.version === "string" ? manifest.version : undefined,
      min_ludus_version:
        typeof manifest.min_ludus_version === "string" ? manifest.min_ludus_version : undefined,
    }
  } catch {
    return null
  }
}

export async function listGitSourceTemplates(
  gitUrl: string,
  ref: string,
): Promise<Array<{ name: string }>> {
  const names = await listGitSubdirs(gitUrl, ref, "templates")
  return names.map((name) => ({ name }))
}

export async function listGitSourceRoles(
  gitUrl: string,
  ref: string,
): Promise<Array<{ name: string; scope: "local" }>> {
  const names = await listGitSubdirs(gitUrl, ref, "ansible/roles")
  return names.map((name) => ({ name, scope: "local" as const }))
}

export async function listGitSourceCollections(
  gitUrl: string,
  ref: string,
): Promise<Array<{ name: string; scope: "local" }>> {
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  const names = await listGitSubdirs(gitUrl, ref, "ansible/collections")
  if (!apiBase) return names.map((name) => ({ name, scope: "local" as const }))
  const resolved = await Promise.all(
    names.map(async (dirName) => ({
      name: await resolveGitCollectionFqcn(apiBase, ref || "main", dirName),
      scope: "local" as const,
    })),
  )
  return resolved
}

/** Map short collection dir names to FQCN before POST /sources/{id}/install. */
export async function enrichCollectionInstallNames(
  gitUrl: string,
  ref: string,
  names: string[],
): Promise<string[]> {
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  if (!apiBase) return names
  return Promise.all(
    names.map(async (name) => {
      if (name.includes(".")) return name
      return resolveGitCollectionFqcn(apiBase, ref || "main", name)
    }),
  )
}
