import "server-only"

import {
  enrichCollectionInstallNames,
  gitUrlToGithubApiBase,
} from "@/lib/source-git-catalog"
import { getSettings } from "@/lib/settings-store"
import { extractLudusList } from "@/lib/utils"

const BADSL_GIT_URL = "https://github.com/badsectorlabs/ludus-source-bsl"

export function buildLudusApiUrl(path: string): string {
  const settings = getSettings()
  const cleanBase = settings.ludusUrl.replace(/\/$/, "")
  const apiPath = path.startsWith("/api/v2") ? path : `/api/v2${path}`
  return `${cleanBase}${apiPath}`
}

function normalizeGitUrl(url: string): string {
  return url.trim().replace(/\/$/, "").replace(/\.git$/, "").toLowerCase()
}

export interface LudusSourceRow {
  id?: string
  sourceID?: string
  name?: string
  description?: string
  url?: string
  ref?: string
  kind?: string
  type?: string
  ownerUserID?: string
  lastSyncedAt?: string
  lastSyncStatus?: string
  lastSyncError?: string
}

export interface SourceBlueprintRow {
  id?: string
  sourceID?: string
  sourceBlueprintID?: string
  name?: string
  description?: string
  version?: string
  authors?: string[]
  homepage?: string
  license?: string
  tags?: string[]
  min_ludus_version?: string
}

export interface SourceTemplateRow {
  name?: string
  version?: string
}

export type SourceCatalogInstallState = "not_installed" | "installed" | "upgrade_available" | string

export interface LudusCatalogItem {
  name?: string
  fqcn?: string
  state?: SourceCatalogInstallState
  version?: string
  description?: string
}

export interface LudusSourceCatalog {
  sourceID?: string
  localRoles?: LudusCatalogItem[]
  localCollections?: LudusCatalogItem[]
}

export interface SourceRoleRow {
  name?: string
  version?: string
  scope?: "local" | "subscription" | string
  state?: SourceCatalogInstallState
}

export interface SourceCollectionRow {
  name?: string
  fqcn?: string
  version?: string
  scope?: "local" | "subscription" | string
  state?: SourceCatalogInstallState
}

export interface SourceInstallSelection {
  blueprints?: string[]
  templates?: string[]
  localRoles?: string[]
  localCollections?: string[]
}

export interface SourceInstallResult {
  sourceID: string
  blueprintID: string
  message: string
  warnings: string[]
}

interface ArtifactResult {
  name?: string
  ok?: boolean
  message?: string
}

interface InstallResponse {
  sourceID?: string
  templateResults?: ArtifactResult[]
  blueprintResults?: {
    ansibleResults?: Array<{ name?: string; ok?: boolean; error?: string }>
  }
  error?: string
}

/**
 * True when Ludus lacks the /sources API (pre-2.2.0). Install/sync 404s on 2.2.0 are
 * selection or catalog issues — not a version gate.
 */
export function isSourcesApiUnavailableError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err)
  if (!/\b404\b/i.test(msg) && !/HTTP 404/i.test(msg)) return false
  if (/Source install failed/i.test(msg)) return false
  if (/Source sync failed/i.test(msg)) return false
  return /\/sources\b|list sources|register source|delete source|list source/i.test(msg)
}

/** @deprecated Prefer isSourcesApiUnavailableError — broad "not found" is not a version check. */
export function isHttp404Error(err: unknown): boolean {
  return isSourcesApiUnavailableError(err)
}

async function ludusJson<T>(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(buildLudusApiUrl(path), {
    ...init,
    headers: {
      "X-API-KEY": apiKey,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })
  const data = (await res.json().catch(() => null)) as T | null
  return { ok: res.ok, status: res.status, data }
}

function ludusRows<T>(data: unknown): T[] {
  return extractLudusList<T>(data)
}

function normalizeSourceKey(value: string): string {
  return value.trim().toLowerCase()
}

function rowMatchesSourceId(row: { sourceID?: string; id?: string }, sourceID: string): boolean {
  const want = normalizeSourceKey(sourceID)
  if (!want) return true
  const keys = new Set<string>()
  if (row.sourceID) keys.add(normalizeSourceKey(row.sourceID))
  if (row.id) {
    keys.add(normalizeSourceKey(row.id))
    const slash = row.id.indexOf("/")
    if (slash > 0) keys.add(normalizeSourceKey(row.id.slice(0, slash)))
  }
  return keys.has(want)
}

function filterRowsBySourceId<T extends { sourceID?: string; id?: string }>(
  rows: T[],
  sourceID: string,
): T[] {
  if (!sourceID.trim()) return rows
  return rows.filter((r) => rowMatchesSourceId(r, sourceID))
}

/** List registered Ludus sources (requires Ludus 2.2.0+). */
export async function listSources(apiKey: string): Promise<LudusSourceRow[]> {
  const res = await ludusJson<unknown>("/sources", apiKey, { method: "GET" })
  if (!res.ok) {
    const msg =
      (res.data as { error?: string } | null)?.error ||
      `Failed to list sources (HTTP ${res.status})`
    throw new Error(msg)
  }
  return ludusRows<LudusSourceRow>(res.data)
}

/** Register a new git source explicitly (does not dedupe). */
export async function createGitSource(
  apiKey: string,
  gitUrl: string,
  ref: string,
): Promise<string> {
  const form = new FormData()
  form.append("type", "git")
  form.append("url", gitUrl.replace(/\/$/, ""))
  form.append("ref", ref || "main")

  const created = await ludusJson<{ sourceID?: string; error?: string }>("/sources", apiKey, {
    method: "POST",
    body: form,
  })
  if (!created.ok || !created.data?.sourceID) {
    const msg =
      created.data?.error ||
      (typeof created.data === "object" && created.data && "result" in created.data
        ? String((created.data as { result?: string }).result)
        : null) ||
      `Failed to register source (HTTP ${created.status})`
    throw new Error(msg)
  }
  return created.data.sourceID
}

/** Resolve an existing git source or register a new one. */
export async function ensureGitSource(
  apiKey: string,
  gitUrl: string,
  ref: string,
): Promise<string> {
  const target = normalizeGitUrl(gitUrl)
  const listed = await ludusJson<unknown>("/sources", apiKey, { method: "GET" })
  if (listed.ok) {
    const rows = ludusRows<LudusSourceRow>(listed.data)
    const hit = rows.find((s) => s.url && normalizeGitUrl(s.url) === target)
    if (hit) return hit.sourceID || hit.id || ""
  }

  return createGitSource(apiKey, gitUrl, ref)
}

export async function deleteSource(
  apiKey: string,
  sourceID: string,
  purge: boolean,
): Promise<void> {
  const res = await ludusJson<{ status?: string; error?: string }>(
    `/sources/${encodeURIComponent(sourceID)}`,
    apiKey,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purge }),
    },
  )
  if (!res.ok) {
    const msg = res.data?.error || `Failed to delete source (HTTP ${res.status})`
    throw new Error(msg)
  }
}

export async function syncSource(
  apiKey: string,
  sourceID: string,
  options?: { globalRoles?: boolean; force?: boolean; dryRun?: boolean },
): Promise<unknown> {
  const res = await ludusJson<unknown>(
    `/sources/${encodeURIComponent(sourceID)}/sync`,
    apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    },
  )
  if (!res.ok) {
    const msg =
      (res.data as { error?: string } | null)?.error ||
      `Source sync failed (HTTP ${res.status})`
    throw new Error(msg)
  }
  return res.data
}

export async function listSourceBlueprints(
  apiKey: string,
  sourceID: string,
): Promise<SourceBlueprintRow[]> {
  const res = await ludusJson<unknown>(
    `/sources/${encodeURIComponent(sourceID)}/blueprints`,
    apiKey,
    { method: "GET" },
  )
  if (!res.ok) {
    const msg =
      (res.data as { error?: string } | null)?.error ||
      `Failed to list source blueprints (HTTP ${res.status})`
    throw new Error(msg)
  }
  let rows = ludusRows<SourceBlueprintRow>(res.data)
  if (rows.length === 0) {
    const all = await listAllSourceBlueprints(apiKey)
    rows = filterRowsBySourceId(all, sourceID)
  }
  return rows
}

/** Global blueprint index — optional on some Ludus builds; empty when unavailable. */
export async function listAllSourceBlueprints(apiKey: string): Promise<SourceBlueprintRow[]> {
  const res = await ludusJson<unknown>("/sources/blueprints", apiKey, {
    method: "GET",
  })
  if (!res.ok) return []
  return ludusRows<SourceBlueprintRow>(res.data)
}

export async function listSourceTemplates(
  apiKey: string,
  sourceID: string,
): Promise<SourceTemplateRow[]> {
  const res = await ludusJson<unknown>(
    `/sources/${encodeURIComponent(sourceID)}/templates`,
    apiKey,
    { method: "GET" },
  )
  if (!res.ok) {
    const msg =
      (res.data as { error?: string } | null)?.error ||
      `Failed to list source templates (HTTP ${res.status})`
    throw new Error(msg)
  }
  return ludusRows<SourceTemplateRow>(res.data)
}

export async function listSourceRoles(
  apiKey: string,
  sourceID: string,
): Promise<SourceRoleRow[]> {
  const res = await ludusJson<unknown>(
    `/sources/${encodeURIComponent(sourceID)}/roles`,
    apiKey,
    { method: "GET" },
  )
  if (!res.ok) {
    const msg =
      (res.data as { error?: string } | null)?.error ||
      `Failed to list source roles (HTTP ${res.status})`
    throw new Error(msg)
  }
  return ludusRows<SourceRoleRow>(res.data)
}

export async function listSourceCollections(
  apiKey: string,
  sourceID: string,
): Promise<SourceCollectionRow[]> {
  const res = await ludusJson<unknown>(
    `/sources/${encodeURIComponent(sourceID)}/collections`,
    apiKey,
    { method: "GET" },
  )
  if (!res.ok) {
    const msg =
      (res.data as { error?: string } | null)?.error ||
      `Failed to list source collections (HTTP ${res.status})`
    throw new Error(msg)
  }
  return ludusRows<SourceCollectionRow>(res.data)
}

/** Full source catalog with FQCN + install state (Ludus 2.2.0+). */
export async function getSourceCatalog(
  apiKey: string,
  sourceID: string,
): Promise<LudusSourceCatalog | null> {
  const res = await ludusJson<LudusSourceCatalog>(
    `/sources/${encodeURIComponent(sourceID)}/catalog`,
    apiKey,
    { method: "GET" },
  )
  if (!res.ok) return null
  return res.data
}

async function findRegisteredSourceRow(
  apiKey: string,
  sourceID: string,
): Promise<LudusSourceRow | null> {
  const sources = await listSources(apiKey)
  const want = sourceID.trim().toLowerCase()
  return (
    sources.find((s) => (s.sourceID || s.id || "").trim().toLowerCase() === want) ?? null
  )
}

async function normalizeInstallSelection(
  apiKey: string,
  sourceID: string,
  selection: SourceInstallSelection,
): Promise<SourceInstallSelection> {
  const collections = selection.localCollections ?? []
  if (collections.length === 0) return selection

  const catalog = await getSourceCatalog(apiKey, sourceID)
  const catalogByShort = new Map<string, string>()
  for (const item of catalog?.localCollections ?? []) {
    const fqcn = item.fqcn || item.name
    if (!fqcn) continue
    catalogByShort.set(fqcn.toLowerCase(), fqcn)
    if (item.name) catalogByShort.set(item.name.toLowerCase(), fqcn)
    const short = fqcn.includes(".") ? fqcn.slice(fqcn.lastIndexOf(".") + 1) : fqcn
    catalogByShort.set(short.toLowerCase(), fqcn)
  }

  let mapped = collections.map((name) => {
    if (name.includes(".")) return name
    return catalogByShort.get(name.toLowerCase()) ?? name
  })

  const needsGit = mapped.some((name) => !name.includes("."))
  if (needsGit) {
    const src = await findRegisteredSourceRow(apiKey, sourceID)
    if (src?.url && gitUrlToGithubApiBase(src.url)) {
      mapped = await enrichCollectionInstallNames(src.url, src.ref || "main", mapped)
    }
  }

  return { ...selection, localCollections: mapped }
}

function collectInstallWarnings(data: InstallResponse | null): string[] {
  const warnings: string[] = []
  for (const t of data?.templateResults ?? []) {
    if (t.ok === false) {
      warnings.push(`Template ${t.name ?? "?"}: ${t.message ?? "failed"}`)
    }
  }
  for (const r of data?.blueprintResults?.ansibleResults ?? []) {
    if (r.ok === false) {
      warnings.push(`Role ${r.name ?? "?"}: ${r.error ?? "failed"}`)
    }
  }
  return warnings
}

async function installSourceSelection(
  apiKey: string,
  sourceID: string,
  selection: SourceInstallSelection,
): Promise<{ warnings: string[]; data: InstallResponse | null }> {
  const res = await ludusJson<InstallResponse>(
    `/sources/${encodeURIComponent(sourceID)}/install`,
    apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection }),
    },
  )
  if (!res.ok) {
    const msg =
      res.data?.error ||
      (typeof res.data === "object" && res.data && "result" in (res.data as object)
        ? String((res.data as { result?: string }).result)
        : null) ||
      `Source install failed (HTTP ${res.status})`
    throw new Error(msg)
  }
  return { warnings: collectInstallWarnings(res.data), data: res.data }
}

/** Install selected blueprints from a registered Ludus source (templates + ansible deps). */
export async function installSourceBlueprints(
  apiKey: string,
  sourceID: string,
  blueprintIds: string[],
): Promise<{ warnings: string[]; data: InstallResponse | null }> {
  return installSourceSelection(apiKey, sourceID, { blueprints: blueprintIds })
}

/** Install selected templates from a registered Ludus source. */
export async function installSourceTemplates(
  apiKey: string,
  sourceID: string,
  templateNames: string[],
): Promise<{ warnings: string[]; data: InstallResponse | null }> {
  return installSourceSelection(apiKey, sourceID, { templates: templateNames })
}

/** Install arbitrary selection from a registered Ludus source. */
export async function installFromSource(
  apiKey: string,
  sourceID: string,
  selection: SourceInstallSelection,
): Promise<{ warnings: string[]; data: InstallResponse | null }> {
  const normalized = await normalizeInstallSelection(apiKey, sourceID, selection)
  return installSourceSelection(apiKey, sourceID, normalized)
}

export function blueprintPublicId(sourceKey: string, blueprintName: string): string {
  return `${sourceKey}/${blueprintName}`
}

/** Public slug Ludus uses in blueprint IDs (`ludus-source-bsl/goad`), not always the UUID sourceID. */
export async function resolveSourcePublicKey(apiKey: string, sourceID: string): Promise<string> {
  const sources = await listSources(apiKey)
  const want = sourceID.trim().toLowerCase()
  const hit = sources.find((s) => (s.sourceID || s.id || "").trim().toLowerCase() === want)
  if (hit?.name?.trim()) return hit.name.trim()
  if (hit?.url?.trim()) {
    try {
      const parts = new URL(hit.url.replace(/\.git$/, "")).pathname.split("/").filter(Boolean)
      if (parts.length > 0) return parts[parts.length - 1]!
    } catch {
      /* ignore */
    }
  }
  return sourceID
}

export async function findInstalledBlueprintId(
  apiKey: string,
  shortName: string,
  sourceID?: string,
): Promise<string | null> {
  const res = await ludusJson<unknown>("/blueprints", apiKey, { method: "GET" })
  if (!res.ok) return null
  const rows = ludusRows<{ id?: string; blueprintID?: string }>(res.data)
  const candidates = new Set<string>([shortName])
  if (sourceID) {
    const publicKey = await resolveSourcePublicKey(apiKey, sourceID)
    candidates.add(`${publicKey}/${shortName}`)
    candidates.add(`${sourceID}/${shortName}`)
  }
  for (const row of rows) {
    const id = (row.id || row.blueprintID || "").trim()
    if (!id) continue
    if (candidates.has(id)) return id
    if (id.endsWith(`/${shortName}`)) return id
  }
  return null
}

export function gitUrlForBadsectorlabs(): string {
  return BADSL_GIT_URL
}

export function sourceRowId(row: LudusSourceRow): string {
  return row.sourceID || row.id || ""
}
