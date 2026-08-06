import "server-only"

import {
  resolveSourceBlueprints,
  resolveSourceTemplates,
} from "@/lib/source-catalog-resolver"
import {
  ensureGitSource,
  gitUrlForBadsectorlabs,
  listSources,
  type SourceBlueprintRow,
} from "@/lib/ludus-source-client"
import { blueprintShortName } from "@/lib/registered-ludus-sources"
import { fetchGitBlueprintManifest } from "@/lib/source-git-catalog"
import { gitUrlToRepoApiBase } from "@/lib/template-repo-client"

const BADSL_API_BASE = "https://api.github.com/repos/badsectorlabs/ludus-source-bsl"
const BADSL_REF = "main"

export interface LudusCatalogTemplate {
  name: string
  path: string
  files: string[]
  apiBase: string
  ref: string
  version?: string
  catalogSource: "ludus"
}

export interface LudusCatalogBlueprint {
  name: string
  path: string
  files: string[]
  apiBase: string
  ref: string
  title?: string
  description?: string
  version?: string
  min_ludus_version?: string
  sourceBlueprintID?: string
  catalogSource: "ludus" | "github"
}

function normalizeApiBase(apiBase: string): string {
  return apiBase.trim().replace(/\/$/, "").toLowerCase()
}

export function resolveBadslCatalogMeta(): { gitUrl: string; apiBase: string; ref: string } {
  return { gitUrl: gitUrlForBadsectorlabs(), apiBase: BADSL_API_BASE, ref: BADSL_REF }
}

export function mapSourceBlueprintRowsToCatalog(
  rows: SourceBlueprintRow[],
  apiBase: string,
  ref: string,
  catalogSource: LudusCatalogBlueprint["catalogSource"] = "ludus",
): LudusCatalogBlueprint[] {
  const out: LudusCatalogBlueprint[] = []
  for (const b of rows) {
    const name = blueprintShortName(b)
    if (!name) continue
    out.push({
      name,
      path: `blueprints/${name}`,
      files: [],
      apiBase,
      ref,
      title: b.name && b.name !== name ? b.name : undefined,
      description: b.description,
      version: b.version,
      min_ludus_version: b.min_ludus_version,
      sourceBlueprintID: b.sourceBlueprintID,
      catalogSource,
    })
  }
  return out
}

async function enrichBlueprintCatalogFromGit(
  blueprints: LudusCatalogBlueprint[],
): Promise<LudusCatalogBlueprint[]> {
  return Promise.all(
    blueprints.map(async (entry) => {
      const manifest = await fetchGitBlueprintManifest(entry.apiBase, entry.ref, entry.name)
      if (!manifest) return entry
      return {
        ...entry,
        title: manifest.title ?? entry.title,
        description: entry.description || manifest.description,
        version: entry.version || manifest.version,
        min_ludus_version: entry.min_ludus_version || manifest.min_ludus_version,
      }
    }),
  )
}

async function resolveRegisteredSourceMeta(
  apiKey: string,
  sourceID: string,
  fallbackRef: string,
  fallbackApiBase: string,
): Promise<{ ref: string; apiBase: string }> {
  try {
    const sources = await listSources(apiKey)
    const want = sourceID.trim().toLowerCase()
    const src =
      sources.find((s) => (s.sourceID || s.id || "").trim().toLowerCase() === want) ?? null
    const ref = (src?.ref || fallbackRef || "main").trim() || "main"
    const fromUrl = src?.url ? gitUrlToRepoApiBase(src.url) : null
    return { ref, apiBase: fromUrl || fallbackApiBase }
  } catch {
    return { ref: fallbackRef || "main", apiBase: fallbackApiBase }
  }
}

async function fetchMergedBlueprintCatalogBySourceId(
  apiKey: string,
  sourceID: string,
  ref: string,
  apiBase: string,
): Promise<{ blueprints: LudusCatalogBlueprint[]; catalogSource: "ludus" | "github" } | null> {
  const meta = await resolveRegisteredSourceMeta(apiKey, sourceID, ref, apiBase)
  const { items, catalogSource } = await resolveSourceBlueprints(apiKey, sourceID)
  if (items.length === 0) return { blueprints: [], catalogSource }
  const blueprints = await enrichBlueprintCatalogFromGit(
    mapSourceBlueprintRowsToCatalog(items, meta.apiBase, meta.ref, catalogSource),
  )
  return { blueprints, catalogSource }
}

export async function enrichBlueprintCatalogEntries(
  blueprints: LudusCatalogBlueprint[],
): Promise<LudusCatalogBlueprint[]> {
  return enrichBlueprintCatalogFromGit(blueprints)
}

export async function fetchLudusBlueprintCatalogBySourceId(
  apiKey: string,
  sourceID: string,
  ref: string,
  apiBase: string,
): Promise<LudusCatalogBlueprint[] | null> {
  try {
    const merged = await fetchMergedBlueprintCatalogBySourceId(apiKey, sourceID, ref, apiBase)
    return merged?.blueprints ?? null
  } catch {
    return null
  }
}

/** Catalog for a registered Ludus source — same resolution as the Sources page (Ludus API + git fallback). */
export async function fetchRegisteredTemplateCatalog(
  apiKey: string,
  sourceID: string,
  fallbackRef = "main",
  fallbackApiBase = BADSL_API_BASE,
): Promise<{ templates: LudusCatalogTemplate[]; catalogSource: "ludus" | "github" }> {
  const meta = await resolveRegisteredSourceMeta(apiKey, sourceID, fallbackRef, fallbackApiBase)
  const { items, catalogSource } = await resolveSourceTemplates(apiKey, sourceID)
  const templates: LudusCatalogTemplate[] = items
    .filter((t) => t.name)
    .map((t) => ({
      name: t.name!,
      path: `templates/${t.name}`,
      files: [],
      apiBase: meta.apiBase,
      ref: meta.ref,
      version: t.version,
      // Install path uses Ludus Sources when registered; keep "ludus" for banner when API served it.
      catalogSource: "ludus",
    }))
  return { templates, catalogSource }
}

export async function fetchLudusTemplateCatalogBySourceId(
  apiKey: string,
  sourceID: string,
  ref: string,
  apiBase: string,
): Promise<LudusCatalogTemplate[] | null> {
  try {
    const { templates } = await fetchRegisteredTemplateCatalog(apiKey, sourceID, ref, apiBase)
    return templates
  } catch {
    return null
  }
}

export async function fetchLudusTemplateCatalog(
  apiKey: string,
  gitUrl: string,
  ref: string,
  apiBase: string,
): Promise<LudusCatalogTemplate[] | null> {
  try {
    const { listSourceTemplates } = await import("@/lib/ludus-source-client")
    const sourceID = await ensureGitSource(apiKey, gitUrl, ref)
    const rows = await listSourceTemplates(apiKey, sourceID)
    return rows
      .filter((t) => t.name)
      .map((t) => ({
        name: t.name!,
        path: `templates/${t.name}`,
        files: [],
        apiBase,
        ref,
        version: t.version,
        catalogSource: "ludus" as const,
      }))
  } catch {
    return null
  }
}

export async function fetchLudusBlueprintCatalog(
  apiKey: string,
  gitUrl: string,
  ref: string,
  apiBase: string,
): Promise<LudusCatalogBlueprint[] | null> {
  try {
    const sourceID = await ensureGitSource(apiKey, gitUrl, ref)
    const merged = await fetchMergedBlueprintCatalogBySourceId(apiKey, sourceID, ref, apiBase)
    return merged?.blueprints ?? null
  } catch {
    return null
  }
}

export function isBadslApiBase(apiBase: string): boolean {
  return normalizeApiBase(apiBase) === normalizeApiBase(BADSL_API_BASE)
}
