import "server-only"

import {
  getSourceCatalog,
  listSourceBlueprints,
  listSourceCollections,
  listSourceRoles,
  listSourceTemplates,
  listSources,
  type LudusCatalogItem,
  type LudusSourceRow,
  type SourceBlueprintRow,
  type SourceCollectionRow,
  type SourceRoleRow,
  type SourceTemplateRow,
} from "@/lib/ludus-source-client"
import { ludusSourceGitRef } from "@/lib/ludus-source-ref"
import { blueprintShortName } from "@/lib/registered-ludus-sources"
import { ensureSourceFresh } from "@/lib/source-auto-sync"
import {
  enrichCollectionInstallNames,
  enrichRoleVersionsFromGit,
  fetchGitBlueprintManifest,
  gitUrlToGithubApiBase,
  listGitSourceBlueprints,
  listGitSourceCollections,
  listGitSourceRoles,
  listGitSourceTemplates,
  resolveGitCollectionFqcn,
} from "@/lib/source-git-catalog"

/** Prefer git tip blueprint.yml over Ludus sync-cache versions (often stale). */
async function enrichBlueprintVersionsFromGit(
  items: SourceBlueprintRow[],
  gitUrl: string,
  ref: string,
): Promise<SourceBlueprintRow[]> {
  const apiBase = gitUrlToGithubApiBase(gitUrl)
  if (!apiBase || items.length === 0) return items
  return Promise.all(
    items.map(async (item) => {
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
    }),
  )
}

export type SourceCatalogOrigin = "ludus" | "github"

export type SourceCatalogResolveResult<T> = {
  items: T[]
  catalogSource: SourceCatalogOrigin
  /** Git ref from the Sources tab registration (branch/tag/commit). */
  catalogRef: string
}

async function findRegisteredSource(
  apiKey: string,
  sourceID: string,
): Promise<LudusSourceRow | null> {
  const sources = await listSources(apiKey)
  const want = sourceID.trim().toLowerCase()
  return (
    sources.find((s) => (s.sourceID || s.id || "").trim().toLowerCase() === want) ?? null
  )
}

/** Resolve source row and re-pull git working tree when last sync is stale. */
async function prepareRegisteredSource(
  apiKey: string,
  sourceID: string,
): Promise<LudusSourceRow | null> {
  const src = await findRegisteredSource(apiKey, sourceID)
  if (src) await ensureSourceFresh(apiKey, src)
  return src
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
  const ludus = await ludusCatalogOrEmpty(() => listSourceBlueprints(apiKey, sourceID))

  let git: Array<{ name: string; sourceBlueprintID: string }> = []
  if (src?.url) {
    git = await listGitSourceBlueprints(src.url, catalogRef, sourceID)
  }

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

export async function resolveSourceTemplates(
  apiKey: string,
  sourceID: string,
): Promise<SourceCatalogResolveResult<SourceTemplateRow>> {
  const src = await prepareRegisteredSource(apiKey, sourceID)
  const catalogRef = ludusSourceGitRef(src)
  const ludus = await ludusCatalogOrEmpty(() => listSourceTemplates(apiKey, sourceID))
  if (ludus.length > 0) return { items: ludus, catalogSource: "ludus", catalogRef }

  if (src?.url) {
    const git = await listGitSourceTemplates(src.url, catalogRef)
    if (git.length > 0) return { items: git, catalogSource: "github", catalogRef }
  }
  return { items: [], catalogSource: "ludus", catalogRef }
}

export async function resolveSourceRoles(
  apiKey: string,
  sourceID: string,
): Promise<SourceCatalogResolveResult<SourceRoleRow>> {
  const src = await prepareRegisteredSource(apiKey, sourceID)
  const catalogRef = ludusSourceGitRef(src)
  const catalog = await getSourceCatalog(apiKey, sourceID)

  let items: SourceRoleRow[] = []
  let catalogSource: SourceCatalogOrigin = "ludus"

  if (catalog?.localRoles?.length) {
    items = catalog.localRoles.map(mapCatalogRole)
  } else {
    const ludus = await ludusCatalogOrEmpty(() => listSourceRoles(apiKey, sourceID))
    if (ludus.length > 0) {
      items = ludus
    } else if (src?.url) {
      const git = await listGitSourceRoles(src.url, catalogRef)
      if (git.length > 0) {
        items = git
        catalogSource = "github"
      }
    }
  }

  // Prefer git tip (Sources-tab ref) over Ludus sync cache.
  if (src?.url && items.length > 0) {
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
  const catalog = await getSourceCatalog(apiKey, sourceID)
  if (catalog?.localCollections?.length) {
    return {
      items: catalog.localCollections.map(mapCatalogCollection),
      catalogSource: "ludus",
      catalogRef,
    }
  }

  const ludus = await ludusCatalogOrEmpty(() => listSourceCollections(apiKey, sourceID))
  let items = ludus
  let catalogSource: SourceCatalogOrigin = "ludus"

  if (ludus.length === 0 && src?.url) {
    const git = await listGitSourceCollections(src.url, catalogRef)
    if (git.length > 0) {
      items = git
      catalogSource = "github"
    }
  } else if (src?.url && items.length > 0) {
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
