import "server-only"

import yaml from "js-yaml"
import { parseGalaxyCollectionFqcn } from "@/lib/ansible/ansible-collection-fqcn"
import {
  githubApiPath,
  githubRepoFromApiBase,
  listGitHubRepoTree,
  listRepoDirectory,
  fetchRepoRawFile,
  parseGitHubCloneUrl,
  type RepoTreeItem,
} from "@/lib/templates/template-repo-client"
import { DEFAULT_SOURCE_GIT_REF } from "@/lib/sources/ludus-source-ref"
import { ludusTemplateInstallName, trimTrailingSlashes } from "@/lib/templates/packer-vm-name"
import { sourceBlueprintInstallId } from "@/lib/sources/registered-ludus-sources"

const GITHUB_FETCH_HEADERS = { "User-Agent": "ludus-ux/1.0", Accept: "application/vnd.github+json" }

function gitRefOrDefault(ref: string | undefined | null): string {
  const t = (ref ?? "").trim()
  return t || DEFAULT_SOURCE_GIT_REF
}

interface GitHubContentEntry {
  git_url?: string
}

/** Git submodule entries appear as blobs or gitlinks under ansible/roles|collections. */
export function gitCatalogEntryNames(items: RepoTreeItem[], dirPath: string): string[] {
  const ansiblePath = dirPath.startsWith("ansible/")
  return items
    .filter((i) => i.type === "tree" || (ansiblePath && (i.type === "blob" || i.type === "commit")))
    .map((i) => i.name)
}

/** Immediate children of `dirPath` in a recursive tree. */
export function directGitChildren(items: RepoTreeItem[], dirPath: string): RepoTreeItem[] {
  const prefix = `${dirPath.replace(/\/+$/, "")}/`
  return items.filter((item) => {
    if (!item.path.startsWith(prefix)) return false
    const rest = item.path.slice(prefix.length)
    return rest.length > 0 && !rest.includes("/")
  })
}

/** Prefer meta/version.yml, then meta/main.yml, when the tree already lists them. */
export function roleMetaVersionPath(items: RepoTreeItem[], roleDir: string): string | null {
  const version = `ansible/roles/${roleDir}/meta/version.yml`
  const main = `ansible/roles/${roleDir}/meta/main.yml`
  if (items.some((item) => item.path === version && item.type === "blob")) return version
  if (items.some((item) => item.path === main && item.type === "blob")) return main
  return null
}

/** Packer file directly inside `templates/<dir>/`. */
export function templatePackerPath(items: RepoTreeItem[], dirName: string): string | null {
  const prefix = `templates/${dirName}/`
  const hit = items.find((item) => {
    if (item.type !== "blob" || !item.path.startsWith(prefix)) return false
    const rest = item.path.slice(prefix.length)
    return rest.length > 0 && !rest.includes("/") && (rest.endsWith(".pkr.hcl") || rest.endsWith(".pkr.json"))
  })
  return hit?.path ?? null
}

export function gitUrlToGithubApiBase(gitUrl: string): string | null {
  const repo = parseGitHubCloneUrl(gitUrl)
  if (!repo) return null
  return githubApiPath(repo)
}

async function fetchGalaxyFqcnFromRepo(repo: string, ref: string): Promise<string | null> {
  // Only the Sources-tab ref — never silently fall back to main/master (wrong branch content).
  const branch = gitRefOrDefault(ref)
  const [owner, name] = repo.split("/")
  if (!owner || !name || name.includes("/")) return null
  const encodedRef = branch.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/")
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${encodedRef}/galaxy.yml`,
      {
        headers: GITHUB_FETCH_HEADERS,
        cache: "no-store",
      },
    )
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
    const raw = await fetchRepoRawFile(apiBase, `ansible/collections/${dirName}/galaxy.yml`, branch)
    const fqcn = parseGalaxyCollectionFqcn(raw)
    if (fqcn) return fqcn
  } catch {
    /* inline collection or fetch failure */
  }

  try {
    const repo = githubRepoFromApiBase(apiBase)
    if (!repo) return dirName
    const url = `${githubApiPath(repo, "contents", "ansible", "collections", dirName)}?ref=${encodeURIComponent(branch)}`
    const res = await fetch(url, { headers: GITHUB_FETCH_HEADERS, cache: "no-store" })
    if (res.ok) {
      const item = (await res.json()) as GitHubContentEntry
      const submodule = item.git_url?.match(/repos\/([^/]+\/[^/]+)\/git/)?.[1]
      if (submodule) {
        const fqcn = await fetchGalaxyFqcnFromRepo(submodule, branch)
        if (fqcn) return fqcn
      }
    }
  } catch {
    /* submodule lookup failure */
  }

  return dirName
}

const GIT_CATALOG_CONCURRENCY = 8

export async function mapGitCatalogWork<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  return mapWithConcurrency(items, GIT_CATALOG_CONCURRENCY, fn)
}

async function githubTreeOrEmpty(apiBase: string, ref: string): Promise<RepoTreeItem[]> {
  try {
    return await listGitHubRepoTree(apiBase, ref)
  } catch {
    return []
  }
}

async function listGitSubdirs(gitUrl: string, ref: string, dirPath: string): Promise<string[]> {
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  if (!apiBase) return []
  const branch = gitRefOrDefault(ref)
  const tree = await githubTreeOrEmpty(apiBase, branch)
  if (tree.length > 0) {
    return gitCatalogEntryNames(directGitChildren(tree, dirPath), dirPath)
  }
  try {
    const listed = await listRepoDirectory(apiBase, dirPath, branch)
    return gitCatalogEntryNames(listed, dirPath)
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

/**
 * Template install id from a source directory.
 * Ludus keys templates by Packer `vm_name`, not the folder (`debian13` → `debian-13-x64-server-template`).
 */
export async function resolveGitTemplateInstallName(
  apiBase: string,
  ref: string,
  dirName: string,
  fileNames?: string[],
  templatePath?: string,
): Promise<string> {
  const branch = gitRefOrDefault(ref)
  const dirPath = trimTrailingSlashes(templatePath || `templates/${dirName}`)
  const listed = fileNames?.find((f) => f.endsWith(".pkr.hcl") || f.endsWith(".pkr.json"))
  const candidates = listed
    ? [`${dirPath}/${listed}`]
    : [`${dirPath}/${dirName}.pkr.hcl`, `${dirPath}/${dirName}.pkr.json`]
  for (const path of candidates) {
    try {
      const raw = await fetchRepoRawFile(apiBase, path, branch)
      return ludusTemplateInstallName(dirName, raw)
    } catch {
      /* try the next Packer filename */
    }
  }
  return dirName
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  const workers = Math.min(Math.max(limit, 1), items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

export async function listGitSourceTemplates(
  gitUrl: string,
  ref: string,
): Promise<Array<{ name: string; path: string }>> {
  const names = await listGitSubdirs(gitUrl, ref, "templates")
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  if (!apiBase) return names.map((name) => ({ name, path: `templates/${name}` }))
  const branch = gitRefOrDefault(ref)
  const tree = await githubTreeOrEmpty(apiBase, branch)
  return mapGitCatalogWork(names, async (dir) => {
    const packer = templatePackerPath(tree, dir)
    const fileName = packer ? packer.slice(packer.lastIndexOf("/") + 1) : undefined
    return {
      name: await resolveGitTemplateInstallName(
        apiBase,
        branch,
        dir,
        fileName ? [fileName] : undefined,
        `templates/${dir}`,
      ),
      path: `templates/${dir}`,
    }
  })
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

async function readRoleVersionFile(
  apiBase: string,
  ref: string,
  path: string,
): Promise<string | undefined> {
  try {
    return parseAnsibleRoleVersionYaml(await fetchRepoRawFile(apiBase, path, ref))
  } catch {
    return undefined
  }
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
  const tree = await githubTreeOrEmpty(apiBase, branch)
  return mapGitCatalogWork(names, async (name) => {
    const known = roleMetaVersionPath(tree, name)
    const version = known
      ? await readRoleVersionFile(apiBase, branch, known)
      : tree.length > 0
        ? undefined
        : await fetchGitRoleVersion(apiBase, branch, name)
    return { name, version, scope: "local" as const }
  })
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
  const tree = await githubTreeOrEmpty(apiBase, branch)
  return mapGitCatalogWork(items, async (item) => {
    const name = (item.name ?? "").trim()
    if (!name) return item
    const dir = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name
    const known = roleMetaVersionPath(tree, dir)
    const version = known
      ? await readRoleVersionFile(apiBase, branch, known)
      : tree.length > 0
        ? undefined
        : await fetchGitRoleVersion(apiBase, branch, dir)
    return version ? { ...item, version } : item
  })
}

export async function listGitSourceCollections(
  gitUrl: string,
  ref: string,
): Promise<Array<{ name: string; scope: "local" }>> {
  const branch = gitRefOrDefault(ref)
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  const names = await listGitSubdirs(gitUrl, branch, "ansible/collections")
  if (!apiBase) return names.map((name) => ({ name, scope: "local" as const }))
  return mapGitCatalogWork(names, async (dirName) => ({
    name: await resolveGitCollectionFqcn(apiBase, branch, dirName),
    scope: "local" as const,
  }))
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
  return mapGitCatalogWork(names, async (name) => {
    if (name.includes(".")) return name
    return resolveGitCollectionFqcn(apiBase, branch, name)
  })
}
