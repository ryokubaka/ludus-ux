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
import { blueprintShortName } from "@/lib/registered-ludus-sources"
import {
  enrichCollectionInstallNames,
  gitUrlToGithubApiBase,
  listGitSourceBlueprints,
  listGitSourceCollections,
  listGitSourceRoles,
  listGitSourceTemplates,
  resolveGitCollectionFqcn,
} from "@/lib/source-git-catalog"

export type SourceCatalogOrigin = "ludus" | "github"

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
      const fqcn = await resolveGitCollectionFqcn(apiBase, ref || "main", name)
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
): Promise<{ items: SourceBlueprintRow[]; catalogSource: SourceCatalogOrigin }> {
  const ludus = await ludusCatalogOrEmpty(() => listSourceBlueprints(apiKey, sourceID))
  const src = await findRegisteredSource(apiKey, sourceID)

  let git: Array<{ name: string; sourceBlueprintID: string }> = []
  if (src?.url) {
    git = await listGitSourceBlueprints(src.url, src.ref || "main", sourceID)
  }

  if (ludus.length === 0 && git.length === 0) {
    return { items: [], catalogSource: "ludus" }
  }
  if (git.length === 0) {
    return {
      items: ludus.map((r) => normalizeSourceBlueprintRow(r, sourceID)),
      catalogSource: "ludus",
    }
  }
  if (ludus.length === 0) {
    return {
      items: git.map((g) => ({
        name: g.name,
        sourceBlueprintID: g.sourceBlueprintID,
        sourceID,
      })),
      catalogSource: "github",
    }
  }

  return {
    items: mergeSourceBlueprintRows(ludus, git, sourceID),
    catalogSource: "ludus",
  }
}

export async function resolveSourceTemplates(
  apiKey: string,
  sourceID: string,
): Promise<{ items: SourceTemplateRow[]; catalogSource: SourceCatalogOrigin }> {
  const ludus = await ludusCatalogOrEmpty(() => listSourceTemplates(apiKey, sourceID))
  if (ludus.length > 0) return { items: ludus, catalogSource: "ludus" }

  const src = await findRegisteredSource(apiKey, sourceID)
  if (src?.url) {
    const git = await listGitSourceTemplates(src.url, src.ref || "main")
    if (git.length > 0) return { items: git, catalogSource: "github" }
  }
  return { items: [], catalogSource: "ludus" }
}

export async function resolveSourceRoles(
  apiKey: string,
  sourceID: string,
): Promise<{ items: SourceRoleRow[]; catalogSource: SourceCatalogOrigin }> {
  const catalog = await getSourceCatalog(apiKey, sourceID)
  if (catalog?.localRoles?.length) {
    return { items: catalog.localRoles.map(mapCatalogRole), catalogSource: "ludus" }
  }

  const ludus = await ludusCatalogOrEmpty(() => listSourceRoles(apiKey, sourceID))
  if (ludus.length > 0) return { items: ludus, catalogSource: "ludus" }

  const src = await findRegisteredSource(apiKey, sourceID)
  if (src?.url) {
    const git = await listGitSourceRoles(src.url, src.ref || "main")
    if (git.length > 0) return { items: git, catalogSource: "github" }
  }
  return { items: [], catalogSource: "ludus" }
}

export async function resolveSourceCollections(
  apiKey: string,
  sourceID: string,
): Promise<{ items: SourceCollectionRow[]; catalogSource: SourceCatalogOrigin }> {
  const catalog = await getSourceCatalog(apiKey, sourceID)
  if (catalog?.localCollections?.length) {
    return { items: catalog.localCollections.map(mapCatalogCollection), catalogSource: "ludus" }
  }

  const src = await findRegisteredSource(apiKey, sourceID)
  const ludus = await ludusCatalogOrEmpty(() => listSourceCollections(apiKey, sourceID))
  let items = ludus
  let catalogSource: SourceCatalogOrigin = "ludus"

  if (ludus.length === 0 && src?.url) {
    const git = await listGitSourceCollections(src.url, src.ref || "main")
    if (git.length > 0) {
      items = git
      catalogSource = "github"
    }
  } else if (src?.url && items.length > 0) {
    items = await enrichCollectionRows(items, src.url, src.ref || "main")
  }

  if (src?.url && items.length > 0 && items.some((i) => !(i.name ?? "").includes("."))) {
    const names = await enrichCollectionInstallNames(
      src.url,
      src.ref || "main",
      items.map((i) => i.name || ""),
    )
    items = items.map((item, idx) => ({ ...item, name: names[idx], fqcn: names[idx] }))
  }

  return { items, catalogSource }
}
