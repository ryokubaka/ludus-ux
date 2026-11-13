import "server-only"

import { createHash } from "node:crypto"
import {
  getSourceCatalog,
  listSourceBlueprints,
  listSourceCollections,
  listSourceRoles,
  listSourceTemplates,
  listSources,
  peekCachedSourceList,
  type LudusCatalogItem,
  type LudusSourceCatalog,
  type LudusSourceRow,
  type SourceBlueprintRow,
  type SourceCollectionRow,
  type SourceRoleRow,
  type SourceTemplateRow,
} from "@/lib/sources/ludus-source-client"
import { ludusSourceGitRef } from "@/lib/sources/ludus-source-ref"
import { blueprintShortName } from "@/lib/sources/registered-ludus-sources"
import {
  enrichCollectionInstallNames,
  enrichRoleVersionsFromGit,
  fetchGitBlueprintManifest,
  gitUrlToGithubApiBase,
  listGitSourceBlueprints,
  listGitSourceCollections,
  listGitSourceRoles,
  listGitSourceTemplates,
  mapGitCatalogWork,
  resolveGitCollectionFqcn,
} from "@/lib/sources/source-git-catalog"

/** Prefer git tip blueprint.yml over Ludus sync-cache versions (often stale). */
async function enrichBlueprintVersionsFromGit(
  items: SourceBlueprintRow[],
  gitUrl: string,
  ref: string,
): Promise<SourceBlueprintRow[]> {
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  if (!apiBase || items.length === 0) return items
  return mapGitCatalogWork(items, async (item) => {
    const short = blueprintShortName(item)
    if (!short) return item
    const manifest = await fetchGitBlueprintManifest(apiBase, ref, short)
    if (!manifest) return item
    return {
      ...item,
      version: manifest.version || item.version,
      description: item.description || manifest.description,
      min_ludus_version: item.min_ludus_version || manifest.min_ludus_version,
    }
  })
}

export type SourceCatalogOrigin = "ludus" | "github"

export type SourceCatalogResolveResult<T> = {
  items: T[]
  catalogSource: SourceCatalogOrigin
  /** Git ref from the Sources tab registration (branch/tag/commit). */
  catalogRef: string
}

function findSourceRow(sources: LudusSourceRow[], sourceID: string): LudusSourceRow | null {
  const want = sourceID.trim().toLowerCase()
  return (
    sources.find((s) => (s.sourceID || s.id || "").trim().toLowerCase() === want) ?? null
  )
}

async function findRegisteredSource(
  apiKey: string,
  sourceID: string,
): Promise<LudusSourceRow | null> {
  const cached = peekCachedSourceList(apiKey)
  if (cached) return findSourceRow(cached, sourceID)
  return findSourceRow(await listSources(apiKey), sourceID)
}

/**
 * URL and ref for this registration. Catalog reads use the git remote.
 * A pull runs from Sync, from the background interval, and from an install
 * when the clone is stale — not while the modules are loading.
 */
async function prepareRegisteredSource(
  apiKey: string,
  sourceID: string,
): Promise<LudusSourceRow | null> {
  return findRegisteredSource(apiKey, sourceID)
}

/** Ludus catalog calls wait this long when git can already name the modules. */
const LUDUS_CATALOG_WAIT_MS = 4_000

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

const catalogInflight = new Map<string, Promise<LudusSourceCatalog | null>>()

function sourceCatalogShared(apiKey: string, sourceID: string): Promise<LudusSourceCatalog | null> {
  const cacheKey = `${createHash("sha256").update(apiKey).digest("hex")}\n${sourceID}`
  const pending = catalogInflight.get(cacheKey)
  if (pending) return pending
  const run = getSourceCatalog(apiKey, sourceID).finally(() => {
    catalogInflight.delete(cacheKey)
  })
  catalogInflight.set(cacheKey, run)
  return run
}

async function ludusCatalogOrEmpty<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn()
  } catch {
    return []
  }
}

function mapCatalogRole(item: LudusCatalogItem): SourceRoleRow {
  return {
    name: item.name,
    version: item.version,
    scope: "local",
    state: item.state,
  }
}

function mapCatalogCollection(item: LudusCatalogItem): SourceCollectionRow {
  const installName = item.fqcn || item.name
  return {
    name: installName,
    fqcn: item.fqcn,
    version: item.version,
    scope: "local",
    state: item.state,
  }
}

async function enrichCollectionRows(
  items: SourceCollectionRow[],
  gitUrl: string,
  ref: string,
): Promise<SourceCollectionRow[]> {
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  if (!apiBase) return items
  return Promise.all(
    items.map(async (item) => {
      const name = item.name?.trim() || ""
      if (!name || name.includes(".")) return item
      const fqcn = await resolveGitCollectionFqcn(apiBase, ref, name)
      return { ...item, name: fqcn, fqcn }
    }),
  )
}

function normalizeSourceBlueprintRow(row: SourceBlueprintRow, sourceID: string): SourceBlueprintRow {
  const short = blueprintShortName(row)
  if (!short) return row
  return {
    ...row,
    name: short,
    sourceID,
    sourceBlueprintID: row.sourceBlueprintID?.includes("/")
      ? row.sourceBlueprintID
      : `${sourceID}/${short}`,
  }
}

function mergeSourceBlueprintRows(
  ludus: SourceBlueprintRow[],
  git: Array<{ name: string; sourceBlueprintID: string }>,
  sourceID: string,
): SourceBlueprintRow[] {
  const ludusByShort = new Map<string, SourceBlueprintRow>()
  for (const row of ludus) {
    const short = blueprintShortName(row).toLowerCase()
    if (short) ludusByShort.set(short, normalizeSourceBlueprintRow(row, sourceID))
  }

  if (git.length === 0) {
    return [...ludusByShort.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
  }

  const merged: SourceBlueprintRow[] = []
  const seen = new Set<string>()
  for (const g of git) {
    const short = g.name
    const key = short.toLowerCase()
    seen.add(key)
    const meta = ludusByShort.get(key)
    merged.push(
      meta
        ? { ...meta, name: short, sourceBlueprintID: g.sourceBlueprintID }
        : {
            name: short,
            sourceBlueprintID: g.sourceBlueprintID,
            sourceID,
          },
    )
  }

  for (const [key, row] of ludusByShort) {
    if (!seen.has(key)) merged.push(row)
  }

  return merged.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
}

export async function resolveSourceBlueprints(
  apiKey: string,
  sourceID: string,
): Promise<SourceCatalogResolveResult<SourceBlueprintRow>> {
  const src = await prepareRegisteredSource(apiKey, sourceID)
  const catalogRef = ludusSourceGitRef(src)
  const ludusPromise = ludusCatalogOrEmpty(() => listSourceBlueprints(apiKey, sourceID))
  const gitPromise = src?.url
    ? listGitSourceBlueprints(src.url, catalogRef, sourceID)
    : Promise.resolve([] as Array<{ name: string; sourceBlueprintID: string }>)
  const git = await gitPromise
  const ludus = git.length > 0 ? await withTimeout(ludusPromise, LUDUS_CATALOG_WAIT_MS, []) : await ludusPromise

  let items: SourceBlueprintRow[] = []
  let catalogSource: SourceCatalogOrigin = "ludus"

  if (ludus.length === 0 && git.length === 0) {
    return { items: [], catalogSource: "ludus", catalogRef }
  }
  if (git.length === 0) {
    items = ludus.map((r) => normalizeSourceBlueprintRow(r, sourceID))
  } else if (ludus.length === 0) {
    items = git.map((g) => ({
      name: g.name,
      sourceBlueprintID: g.sourceBlueprintID,
      sourceID,
    }))
    catalogSource = "github"
  } else {
    items = mergeSourceBlueprintRows(ludus, git, sourceID)
  }

  if (src?.url && items.length > 0) {
    items = await enrichBlueprintVersionsFromGit(items, src.url, catalogRef)
  }

  return { items, catalogSource, catalogRef }
}

/**
 * Membership comes from the git tree. A Ludus source cache that only knows
 * installed templates must not hide the rest of `templates/`.
 */
export function mergeSourceTemplateRows(
  ludus: SourceTemplateRow[],
  git: Array<{ name: string; path?: string }>,
): SourceTemplateRow[] {
  const byName = new Map<string, SourceTemplateRow>()
  for (const row of ludus) {
    const name = (row.name ?? "").trim()
    if (!name) continue
    byName.set(name.toLowerCase(), { ...row, name })
  }
  for (const entry of git) {
    const name = entry.name.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const existing = byName.get(key)
    if (existing) {
      if (!existing.path && entry.path) byName.set(key, { ...existing, path: entry.path })
      continue
    }
    byName.set(key, { name, path: entry.path })
  }
  return [...byName.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
}

export async function resolveSourceTemplates(
  apiKey: string,
  sourceID: string,
): Promise<SourceCatalogResolveResult<SourceTemplateRow>> {
  const src = await prepareRegisteredSource(apiKey, sourceID)
  const catalogRef = ludusSourceGitRef(src)
  const ludusPromise = ludusCatalogOrEmpty(() => listSourceTemplates(apiKey, sourceID))
  const gitPromise = src?.url
    ? listGitSourceTemplates(src.url, catalogRef)
    : Promise.resolve([] as Array<{ name: string; path: string }>)
  const git = await gitPromise
  const ludus = git.length > 0 ? await withTimeout(ludusPromise, LUDUS_CATALOG_WAIT_MS, []) : await ludusPromise

  if (ludus.length === 0 && git.length === 0) {
    return { items: [], catalogSource: "ludus", catalogRef }
  }

  const items = mergeSourceTemplateRows(ludus, git)
  const catalogSource: SourceCatalogOrigin = ludus.length === 0 && git.length > 0 ? "github" : "ludus"
  return { items, catalogSource, catalogRef }
}

export async function resolveSourceRoles(
  apiKey: string,
  sourceID: string,
): Promise<SourceCatalogResolveResult<SourceRoleRow>> {
  const src = await prepareRegisteredSource(apiKey, sourceID)
  const catalogRef = ludusSourceGitRef(src)
  const catalogPromise = sourceCatalogShared(apiKey, sourceID)
  const catalog = src?.url
    ? await withTimeout(catalogPromise, LUDUS_CATALOG_WAIT_MS, null)
    : await catalogPromise

  let items: SourceRoleRow[] = []
  let catalogSource: SourceCatalogOrigin = "ludus"

  if (catalog?.localRoles?.length) {
    items = catalog.localRoles.map(mapCatalogRole)
  } else if (src?.url) {
    const git = await listGitSourceRoles(src.url, catalogRef)
    if (git.length > 0) {
      items = git
      catalogSource = "github"
    }
  }
  if (items.length === 0) {
    items = await ludusCatalogOrEmpty(() => listSourceRoles(apiKey, sourceID))
    catalogSource = "ludus"
  }

  // Prefer git tip (Sources-tab ref) over Ludus sync cache. Git listing already read those files.
  if (src?.url && catalogSource === "ludus" && items.length > 0) {
    items = (await enrichRoleVersionsFromGit(items, src.url, catalogRef)) as SourceRoleRow[]
  }

  return { items, catalogSource, catalogRef }
}

export async function resolveSourceCollections(
  apiKey: string,
  sourceID: string,
): Promise<SourceCatalogResolveResult<SourceCollectionRow>> {
  const src = await prepareRegisteredSource(apiKey, sourceID)
  const catalogRef = ludusSourceGitRef(src)
  const catalogPromise = sourceCatalogShared(apiKey, sourceID)
  const catalog = src?.url
    ? await withTimeout(catalogPromise, LUDUS_CATALOG_WAIT_MS, null)
    : await catalogPromise
  if (catalog?.localCollections?.length) {
    return {
      items: catalog.localCollections.map(mapCatalogCollection),
      catalogSource: "ludus",
      catalogRef,
    }
  }

  if (src?.url) {
    const git = await listGitSourceCollections(src.url, catalogRef)
    if (git.length > 0) {
      return { items: git, catalogSource: "github", catalogRef }
    }
  }

  let items = await ludusCatalogOrEmpty(() => listSourceCollections(apiKey, sourceID))
  const catalogSource: SourceCatalogOrigin = "ludus"
  if (src?.url && items.length > 0) {
    items = await enrichCollectionRows(items, src.url, catalogRef)
  }

  if (src?.url && items.length > 0 && items.some((i) => !(i.name ?? "").includes("."))) {
    const names = await enrichCollectionInstallNames(
      src.url,
      catalogRef,
      items.map((i) => i.name || ""),
    )
    items = items.map((item, idx) => ({ ...item, name: names[idx], fqcn: names[idx] }))
  }

  return { items, catalogSource, catalogRef }
}
