import "server-only"

import yaml from "js-yaml"
import { parseGalaxyCollectionFqcn } from "@/lib/ansible-collection-fqcn"
import {
  githubRawFileUrl,
  listRepoDirectory,
  fetchRepoRawFile,
  type RepoTreeItem,
} from "@/lib/template-repo-client"
import { DEFAULT_SOURCE_GIT_REF } from "@/lib/ludus-source-ref"
import { sourceBlueprintInstallId } from "@/lib/registered-ludus-sources"

const GITHUB_FETCH_HEADERS = { "User-Agent": "ludus-ux/1.0", Accept: "application/vnd.github+json" }

function gitRefOrDefault(ref: string | undefined | null): string {
  const t = (ref ?? "").trim()
  return t || DEFAULT_SOURCE_GIT_REF
}

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
  // Only the Sources-tab ref — never silently fall back to main/master (wrong branch content).
  const branch = gitRefOrDefault(ref)
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/galaxy.yml`, {
      headers: GITHUB_FETCH_HEADERS,
      cache: "no-store",
    })
    if (!res.ok) return null
    return parseGalaxyCollectionFqcn(await res.text())
  } catch {
    return null
  }
}

/** Ludus install expects collection FQCN (namespace.name), not git submodule dir names. */
export async function resolveGitCollectionFqcn(
  apiBase: string,
  ref: string,
  dirName: string,
): Promise<string> {
  const branch = gitRefOrDefault(ref)
  try {
    const rawUrl = githubRawFileUrl(apiBase, `ansible/collections/${dirName}/galaxy.yml`, branch)
    const res = await fetch(rawUrl, { headers: GITHUB_FETCH_HEADERS, cache: "no-store" })
    if (res.ok) {
      const fqcn = parseGalaxyCollectionFqcn(await res.text())
      if (fqcn) return fqcn
    }
  } catch {
    /* inline collection or fetch failure */
  }

  try {
    const url = `${apiBase}/contents/ansible/collections/${encodeURIComponent(dirName)}?ref=${encodeURIComponent(branch)}`
    const res = await fetch(url, { headers: GITHUB_FETCH_HEADERS, cache: "no-store" })
    if (res.ok) {
      const item = (await res.json()) as GitHubContentEntry
      const repo = item.git_url?.match(/repos\/([^/]+\/[^/]+)\/git/)?.[1]
      if (repo) {
        const fqcn = await fetchGalaxyFqcnFromRepo(repo, branch)
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
    const tree = await listRepoDirectory(apiBase, dirPath, gitRefOrDefault(ref))
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

/** Parse `meta/version.yml` or galaxy_info.version from role meta/main.yml. */
export function parseAnsibleRoleVersionYaml(raw: string): string | undefined {
  try {
    const doc = yaml.load(raw) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") return undefined
    if (typeof doc.version === "string" || typeof doc.version === "number") {
      const v = String(doc.version).trim()
      return v || undefined
    }
    const galaxy = doc.galaxy_info
    if (galaxy && typeof galaxy === "object") {
      const gv = (galaxy as Record<string, unknown>).version
      if (typeof gv === "string" || typeof gv === "number") {
        const v = String(gv).trim()
        return v || undefined
      }
    }
  } catch {
    /* ignore */
  }
  return undefined
}

export async function fetchGitRoleVersion(
  apiBase: string,
  ref: string,
  roleDir: string,
): Promise<string | undefined> {
  const branch = gitRefOrDefault(ref)
  for (const path of [
    `ansible/roles/${roleDir}/meta/version.yml`,
    `ansible/roles/${roleDir}/meta/main.yml`,
  ]) {
    try {
      const raw = await fetchRepoRawFile(apiBase, path, branch)
      const version = parseAnsibleRoleVersionYaml(raw)
      if (version) return version
    } catch {
      /* try next path */
    }
  }
  return undefined
}

export async function listGitSourceRoles(
  gitUrl: string,
  ref: string,
): Promise<Array<{ name: string; version?: string; scope: "local" }>> {
  const branch = gitRefOrDefault(ref)
  const names = await listGitSubdirs(gitUrl, branch, "ansible/roles")
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  if (!apiBase) {
    return names.map((name) => ({ name, scope: "local" as const }))
  }
  return Promise.all(
    names.map(async (name) => ({
      name,
      version: await fetchGitRoleVersion(apiBase, branch, name),
      scope: "local" as const,
    })),
  )
}

/** Prefer git tip meta/version.yml over Ludus sync-cache versions (often stale/missing). */
export async function enrichRoleVersionsFromGit(
  items: Array<{ name?: string; version?: string }>,
  gitUrl: string,
  ref: string,
): Promise<Array<{ name?: string; version?: string }>> {
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  if (!apiBase || items.length === 0) return items
  const branch = gitRefOrDefault(ref)
  return Promise.all(
    items.map(async (item) => {
      const name = (item.name ?? "").trim()
      if (!name) return item
      const dir = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name
      const version = await fetchGitRoleVersion(apiBase, branch, dir)
      return version ? { ...item, version } : item
    }),
  )
}

export async function listGitSourceCollections(
  gitUrl: string,
  ref: string,
): Promise<Array<{ name: string; scope: "local" }>> {
  const branch = gitRefOrDefault(ref)
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  const names = await listGitSubdirs(gitUrl, branch, "ansible/collections")
  if (!apiBase) return names.map((name) => ({ name, scope: "local" as const }))
  const resolved = await Promise.all(
    names.map(async (dirName) => ({
      name: await resolveGitCollectionFqcn(apiBase, branch, dirName),
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
  const branch = gitRefOrDefault(ref)
  return Promise.all(
    names.map(async (name) => {
      if (name.includes(".")) return name
      return resolveGitCollectionFqcn(apiBase, branch, name)
    }),
  )
}
