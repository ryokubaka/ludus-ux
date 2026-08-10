import "server-only"

import {
  enrichCollectionInstallNames,
  gitUrlToGithubApiBase,
} from "@/lib/source-git-catalog"
import { getSettings } from "@/lib/settings-store"
import {
  ludusSourceGitRef,
  normalizeGitSourceUrl,
  normalizeLudusSourceRef,
  suggestedLudusSourceId,
} from "@/lib/ludus-source-ref"
import {
  rewriteSourceInstallWarning,
  rewriteSourceInstallWarnings,
  sanitizeSourceSyncPresentation,
} from "@/lib/source-install-warnings"
import {
  isLudusSourceGitPermissionError,
  repairLudusSourcesOwnershipAsRoot,
} from "@/lib/ludus-source-ownership"
import { extractLudusList } from "@/lib/utils"

const BADSL_GIT_URL = "https://github.com/badsectorlabs/ludus-source-bsl"

export function buildLudusApiUrl(path: string): string {
  const settings = getSettings()
  const cleanBase = settings.ludusUrl.replace(/\/$/, "")
  const apiPath = path.startsWith("/api/v2") ? path : `/api/v2${path}`
  return `${cleanBase}${apiPath}`
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
  return ludusRows<LudusSourceRow>(res.data).map((row) => {
    const normalized = normalizeLudusSourceRef(row)
    return { ...normalized, ...sanitizeSourceSyncPresentation(normalized) }
  })
}

/** Register a new git source. Pass `id` to avoid Ludus colliding same-URL different refs. */
export async function createGitSource(
  apiKey: string,
  gitUrl: string,
  ref: string,
  opts?: { id?: string },
): Promise<string> {
  const resolvedRef = ludusSourceGitRef({ ref })
  const form = new FormData()
  form.append("type", "git")
  form.append("url", gitUrl.replace(/\/$/, ""))
  form.append("ref", resolvedRef)
  const id = (opts?.id || suggestedLudusSourceId(gitUrl, resolvedRef)).trim()
  if (id) form.append("id", id)

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
  // Clone runs as ludus; heal in case a prior root-touched tree was reused.
  await repairLudusSourcesOwnershipAsRoot()
  return created.data.sourceID
}

/** Resolve an existing git source (url + ref) or register a new one. */
export async function ensureGitSource(
  apiKey: string,
  gitUrl: string,
  ref: string,
): Promise<string> {
  const target = normalizeGitSourceUrl(gitUrl)
  const wantRef = ludusSourceGitRef({ ref })
  const listed = await ludusJson<unknown>("/sources", apiKey, { method: "GET" })
  if (listed.ok) {
    const rows = ludusRows<LudusSourceRow>(listed.data)
    const hit = rows.find(
      (s) =>
        !!s.url &&
        normalizeGitSourceUrl(s.url) === target &&
        ludusSourceGitRef(s) === wantRef,
    )
    if (hit) return hit.sourceID || hit.id || ""
  }

  return createGitSource(apiKey, gitUrl, wantRef)
}

/** PATCH git source metadata (e.g. change branch/tag). */
export async function updateGitSource(
  apiKey: string,
  sourceID: string,
  patch: { ref?: string; url?: string },
): Promise<void> {
  const form = new FormData()
  if (patch.ref != null && String(patch.ref).trim()) {
    form.append("ref", ludusSourceGitRef({ ref: String(patch.ref) }))
  }
  if (patch.url != null && String(patch.url).trim()) {
    form.append("url", String(patch.url).trim().replace(/\/$/, ""))
  }
  const res = await ludusJson<{ error?: string }>(
    `/sources/${encodeURIComponent(sourceID)}`,
    apiKey,
    { method: "PATCH", body: form },
  )
  if (!res.ok) {
    const msg = res.data?.error || `Failed to update source (HTTP ${res.status})`
    throw new Error(msg)
  }
}

/**
 * Change a git source's tracked ref.
 *
 * Ludus often clones with `--single-branch` (fetch = only the original ref).
 * PATCH + sync then fails: `pathspec '<newref>' did not match`. Delete without
 * purge and re-register so Ludus clones the target ref cleanly.
 */
export async function changeGitSourceRef(
  apiKey: string,
  sourceID: string,
  newRef: string,
): Promise<{ sourceID: string; recreated: boolean; ref: string }> {
  const wantRef = ludusSourceGitRef({ ref: newRef })
  const sources = await listSources(apiKey)
  const row = sources.find((s) => (s.sourceID || s.id) === sourceID)
  if (!row?.url) {
    throw new Error("Source not found or missing URL")
  }
  if (ludusSourceGitRef(row) === wantRef) {
    return { sourceID, recreated: false, ref: wantRef }
  }

  await deleteSource(apiKey, sourceID, false)
  const created = await createGitSource(apiKey, row.url, wantRef, {
    id: suggestedLudusSourceId(row.url, wantRef),
  })
  try {
    await syncSource(apiKey, created, { force: true })
  } catch (err) {
    // Registration succeeded; caller can retry Sync. Surface original error.
    console.warn(
      `[changeGitSourceRef] recreated ${created} but sync failed:`,
      err instanceof Error ? err.message : err,
    )
  }
  return { sourceID: created, recreated: true, ref: wantRef }
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

async function syncSourceOnce(
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
    let msg =
      (res.data as { error?: string } | null)?.error ||
      `Source sync failed (HTTP ${res.status})`
    if (/pathspec .+ did not match/i.test(msg)) {
      msg = `${msg} — Ludus clone is single-branch; change ref via Sources (re-registers) or delete + register with the new branch.`
    }
    throw new Error(msg)
  }
  return res.data
}

/**
 * Refresh a git source working tree via Ludus API.
 *
 * Before sync (and again on git permission errors), LUX chowns
 * `/opt/ludus/sources` to `ludus:ludus` over root SSH so a prior root-owned
 * `.git/objects` tree cannot brick every user's Sync button.
 */
export async function syncSource(
  apiKey: string,
  sourceID: string,
  options?: { globalRoles?: boolean; force?: boolean; dryRun?: boolean },
): Promise<unknown> {
  await repairLudusSourcesOwnershipAsRoot()
  try {
    return await syncSourceOnce(apiKey, sourceID, options)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!isLudusSourceGitPermissionError(msg)) throw err
    console.warn(
      `[LUX] source sync permission error for ${sourceID}; repairing ownership and retrying once`,
    )
    const healed = await repairLudusSourcesOwnershipAsRoot()
    if (!healed) throw err
    return await syncSourceOnce(apiKey, sourceID, options)
  }
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
      mapped = await enrichCollectionInstallNames(src.url, ludusSourceGitRef(src), mapped)
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
  return rewriteSourceInstallWarnings(warnings)
}

export type SourceInstallOptions = {
  force?: boolean
  /**
   * Skip blueprint ansible deps (Ludus `noDeps`).
   * Default true when `force` — targeted Re-sync must not overwrite roles/collections
   * that were not in the selection.
   */
  noDeps?: boolean
  global?: boolean
}

async function installSourceSelection(
  apiKey: string,
  sourceID: string,
  selection: SourceInstallSelection,
  options?: SourceInstallOptions,
): Promise<{ warnings: string[]; data: InstallResponse | null }> {
  const body: {
    selection: SourceInstallSelection
    force?: boolean
    noDeps?: boolean
    global?: boolean
  } = { selection }
  if (options?.force) body.force = true
  // Re-sync (force) of a blueprint otherwise reinstalls its requirements.yml /
  // local role closure — looks like "everything" got re-synced.
  const noDeps = options?.noDeps ?? Boolean(options?.force)
  if (noDeps) body.noDeps = true
  if (options?.global) body.global = true
  const res = await ludusJson<InstallResponse>(
    `/sources/${encodeURIComponent(sourceID)}/install`,
    apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const msg =
      res.data?.error ||
      (typeof res.data === "object" && res.data && "result" in (res.data as object)
        ? String((res.data as { result?: string }).result)
        : null) ||
      `Source install failed (HTTP ${res.status})`
    throw new Error(rewriteSourceInstallWarning(msg))
  }
  return { warnings: collectInstallWarnings(res.data), data: res.data }
}

/** Install selected blueprints from a registered Ludus source (templates + ansible deps). */
export async function installSourceBlueprints(
  apiKey: string,
  sourceID: string,
  blueprintIds: string[],
  options?: SourceInstallOptions,
): Promise<{ warnings: string[]; data: InstallResponse | null }> {
  return installSourceSelection(apiKey, sourceID, { blueprints: blueprintIds }, options)
}

/** Install selected templates from a registered Ludus source. */
export async function installSourceTemplates(
  apiKey: string,
  sourceID: string,
  templateNames: string[],
  options?: SourceInstallOptions,
): Promise<{ warnings: string[]; data: InstallResponse | null }> {
  return installSourceSelection(apiKey, sourceID, { templates: templateNames }, options)
}

/** Install arbitrary selection from a registered Ludus source. */
export async function installFromSource(
  apiKey: string,
  sourceID: string,
  selection: SourceInstallSelection,
  options?: SourceInstallOptions,
): Promise<{ warnings: string[]; data: InstallResponse | null }> {
  const normalized = await normalizeInstallSelection(apiKey, sourceID, selection)
  return installSourceSelection(apiKey, sourceID, normalized, options)
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
