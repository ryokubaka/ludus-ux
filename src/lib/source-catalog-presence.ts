import type { AnsibleItem, BlueprintListItem } from "@/lib/types"
import { sourceBlueprintInstallId } from "@/lib/registered-ludus-sources"

export type CatalogInstallState = "not_installed" | "installed" | "upgrade_available"

export function buildInstalledBlueprintIds(blueprints: BlueprintListItem[]): Set<string> {
  const installedIds = new Set<string>()
  for (const bp of blueprints) {
    const id = (bp.id || bp.blueprintID || "").trim()
    if (!id) continue
    installedIds.add(id)
    const parts = id.split("/").filter(Boolean)
    if (parts.length > 0) installedIds.add(parts[parts.length - 1]!)
    if (parts.length >= 2) {
      installedIds.add(`${parts[parts.length - 2]}/${parts[parts.length - 1]}`)
    }
  }
  return installedIds
}

/** Alias keys → installed blueprint version (when Ludus exposes version). */
export function buildInstalledBlueprintVersions(
  blueprints: BlueprintListItem[],
): Map<string, string> {
  const versions = new Map<string, string>()
  for (const bp of blueprints) {
    const version = (bp.version || "").trim()
    if (!version) continue
    const id = (bp.id || bp.blueprintID || "").trim()
    if (!id) continue
    const keys = [id]
    const parts = id.split("/").filter(Boolean)
    if (parts.length > 0) keys.push(parts[parts.length - 1]!)
    if (parts.length >= 2) {
      keys.push(`${parts[parts.length - 2]}/${parts[parts.length - 1]}`)
    }
    for (const key of keys) {
      if (key && !versions.has(key)) versions.set(key, version)
    }
  }
  return versions
}

export function isSourceCatalogBlueprintInstalled(
  row: { sourceBlueprintID?: string; id?: string; name?: string },
  sourceID: string,
  installedIds: Set<string>,
): boolean {
  const installId = sourceBlueprintInstallId(row, sourceID)
  if (installedIds.has(installId)) return true
  const short = installId.includes("/") ? installId.slice(installId.lastIndexOf("/") + 1) : installId
  if (short && installedIds.has(short)) return true
  const rowName = row.name?.trim()
  if (rowName && installedIds.has(rowName)) return true
  if (rowName?.includes("/")) {
    const rowShort = rowName.slice(rowName.lastIndexOf("/") + 1)
    if (rowShort && installedIds.has(rowShort)) return true
  }
  return false
}

/** Match add-from-source catalog rows against installed Ludus blueprints. */
export function isBlueprintCatalogEntryInstalled(
  entry: { name: string; sourceBlueprintID?: string },
  sourceID: string | undefined,
  installedIds: Set<string>,
): boolean {
  if (sourceID) {
    return isSourceCatalogBlueprintInstalled(
      { name: entry.name, sourceBlueprintID: entry.sourceBlueprintID },
      sourceID,
      installedIds,
    )
  }
  if (installedIds.has(entry.name)) return true
  const slash = entry.name.lastIndexOf("/")
  if (slash >= 0) {
    const short = entry.name.slice(slash + 1)
    if (short && installedIds.has(short)) return true
  }
  return false
}

export function lookupInstalledBlueprintVersion(
  row: { sourceBlueprintID?: string; id?: string; name?: string },
  sourceID: string | undefined,
  versions: Map<string, string>,
): string | undefined {
  const candidates: string[] = []
  if (sourceID) {
    candidates.push(sourceBlueprintInstallId(row, sourceID))
  }
  if (row.sourceBlueprintID) candidates.push(row.sourceBlueprintID)
  if (row.id) candidates.push(row.id)
  if (row.name) {
    candidates.push(row.name)
    const slash = row.name.lastIndexOf("/")
    if (slash >= 0) candidates.push(row.name.slice(slash + 1))
  }
  for (const c of candidates) {
    const key = c.trim()
    if (!key) continue
    const hit = versions.get(key)
    if (hit) return hit
    const short = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key
    if (short && versions.has(short)) return versions.get(short)
  }
  return undefined
}

/** Match keys for a catalog name against installed ansible artifacts (FQCN or short name). */
export function ansibleCatalogNameKeys(catalogName: string): string[] {
  const n = catalogName.trim().toLowerCase()
  if (!n) return []
  const keys = [n]
  if (n.includes(".")) keys.push(n.slice(n.lastIndexOf(".") + 1))
  return keys
}

export function buildInstalledAnsibleNames(
  roles: AnsibleItem[],
  collections: AnsibleItem[],
): Set<string> {
  const names = new Set<string>()
  for (const item of [...roles, ...collections]) {
    const name = (item.name || item.Name || "").trim().toLowerCase()
    if (!name) continue
    names.add(name)
    const dot = name.lastIndexOf(".")
    if (dot >= 0) names.add(name.slice(dot + 1))
  }
  return names
}

/** Lowercased name / short name → installed version string. */
export function buildInstalledAnsibleVersions(
  roles: AnsibleItem[],
  collections: AnsibleItem[],
): Map<string, string> {
  const versions = new Map<string, string>()
  for (const item of [...roles, ...collections]) {
    const name = (item.name || item.Name || "").trim().toLowerCase()
    const version = (item.version || item.Version || "").trim()
    if (!name || !version) continue
    if (!versions.has(name)) versions.set(name, version)
    const dot = name.lastIndexOf(".")
    if (dot >= 0) {
      const short = name.slice(dot + 1)
      if (short && !versions.has(short)) versions.set(short, version)
    }
  }
  return versions
}

export function lookupInstalledAnsibleVersion(
  catalogName: string,
  versions: Map<string, string>,
): string | undefined {
  for (const key of ansibleCatalogNameKeys(catalogName)) {
    const hit = versions.get(key)
    if (hit) return hit
  }
  return undefined
}

export function isAnsibleCatalogNameInstalled(name: string, installed: Set<string>): boolean {
  return ansibleCatalogNameKeys(name).some((key) => installed.has(key))
}

export function isSourceCatalogAnsibleInstalled(
  row: { state?: string; name?: string; fqcn?: string; scope?: string },
  installed: Set<string>,
): boolean {
  const names = [row.fqcn, row.name].filter(Boolean) as string[]
  return names.some((n) => isAnsibleCatalogNameInstalled(n, installed))
}

export function normalizeCatalogVersion(version?: string | null): string {
  return (version ?? "").trim().replace(/^v/i, "")
}

/** True only when both sides are non-empty and differ (no false upgrades on missing data). */
export function catalogVersionsDiffer(
  catalogVersion?: string | null,
  installedVersion?: string | null,
): boolean {
  const catalog = normalizeCatalogVersion(catalogVersion)
  const installed = normalizeCatalogVersion(installedVersion)
  if (!catalog || !installed) return false
  return catalog !== installed
}

/** True when Ludus/list has no usable version (empty, "unknown", placeholder). */
export function isMissingOrUnknownVersion(version?: string | null): boolean {
  const v = (version ?? "").trim()
  if (!v) return true
  if (/^unknown(\s+version)?$/i.test(v)) return true
  if (/^\(unknown( version)?\)$/i.test(v)) return true
  return false
}

/**
 * Prefer Ludus-reported version when usable; else LUX pin from last install/re-sync.
 */
export function effectiveInstalledVersion(
  ludusVersion?: string | null,
  pinVersion?: string | null,
): string | undefined {
  if (!isMissingOrUnknownVersion(ludusVersion)) {
    return normalizeCatalogVersion(ludusVersion)
  }
  if (!isMissingOrUnknownVersion(pinVersion)) {
    return normalizeCatalogVersion(pinVersion)
  }
  return undefined
}

/** Lookup a LUX install pin by catalog/short name (keys are lowercased). */
export function lookupCatalogPinVersion(
  name: string | undefined,
  pins?: Record<string, string> | null,
): string | undefined {
  if (!name || !pins) return undefined
  for (const key of ansibleCatalogNameKeys(name)) {
    const hit = pins[key]?.trim()
    if (hit) return hit
  }
  return undefined
}

/** Fill missing/unknown installed versions from LUX pins (does not overwrite real Ludus versions). */
export function mergeInstalledVersionsWithPins(
  versions: Map<string, string>,
  pins?: Record<string, string> | null,
): Map<string, string> {
  if (!pins) return versions
  const out = new Map(versions)
  for (const [rawName, rawVersion] of Object.entries(pins)) {
    const version = rawVersion?.trim()
    const name = rawName.trim().toLowerCase()
    if (!name || !version) continue
    if (isMissingOrUnknownVersion(out.get(name))) {
      out.set(name, version)
    }
  }
  return out
}

export function resolveCatalogInstallState(opts: {
  present: boolean
  catalogState?: string
  catalogVersion?: string | null
  installedVersion?: string | null
}): CatalogInstallState {
  if (!opts.present) return "not_installed"
  if (catalogVersionsDiffer(opts.catalogVersion, opts.installedVersion)) {
    return "upgrade_available"
  }
  // Catalog tip known but no installed/pin version yet → out of sync until a
  // successful install/re-sync records a LUX pin (Ludus list often omits versions).
  const catalog = normalizeCatalogVersion(opts.catalogVersion)
  if (catalog && isMissingOrUnknownVersion(opts.installedVersion)) {
    return "upgrade_available"
  }
  return "installed"
}

export function sourceCatalogAnsibleInstallState(
  row: { state?: string; name?: string; fqcn?: string; scope?: string; version?: string },
  installed: Set<string>,
  installedVersions?: Map<string, string>,
): CatalogInstallState {
  const present = isSourceCatalogAnsibleInstalled(row, installed)
  const catalogName = row.fqcn || row.name || ""
  const installedVersion = installedVersions
    ? lookupInstalledAnsibleVersion(catalogName, installedVersions)
    : undefined
  return resolveCatalogInstallState({
    present,
    catalogState: row.state,
    catalogVersion: row.version,
    installedVersion,
  })
}

export function sourceCatalogBlueprintInstallState(
  row: { sourceBlueprintID?: string; id?: string; name?: string; version?: string; state?: string },
  sourceID: string | undefined,
  installedIds: Set<string>,
  installedVersions?: Map<string, string>,
): CatalogInstallState {
  const present = sourceID
    ? isSourceCatalogBlueprintInstalled(row, sourceID, installedIds)
    : isBlueprintCatalogEntryInstalled(
        { name: row.name || "", sourceBlueprintID: row.sourceBlueprintID },
        sourceID,
        installedIds,
      )
  const installedVersion = installedVersions
    ? lookupInstalledBlueprintVersion(row, sourceID, installedVersions)
    : undefined
  return resolveCatalogInstallState({
    present,
    catalogState: row.state,
    catalogVersion: row.version,
    installedVersion,
  })
}

/**
 * Format installed → catalog (Sources / Sync UI).
 * Shows `—` for a missing/unknown side when the other side is known.
 */
export function formatVersionTransition(
  installedVersion?: string | null,
  catalogVersion?: string | null,
): string {
  const installed = isMissingOrUnknownVersion(installedVersion)
    ? ""
    : normalizeCatalogVersion(installedVersion)
  const catalog = isMissingOrUnknownVersion(catalogVersion)
    ? ""
    : normalizeCatalogVersion(catalogVersion)
  if (!installed && !catalog) return ""
  return `${installed || "—"} → ${catalog || "—"}`
}

/** Ludus template name aliases → version when exposed. */
export function buildInstalledTemplateVersions(
  templates: Iterable<{ name: string; version?: string }>,
): Map<string, string> {
  const versions = new Map<string, string>()
  for (const t of templates) {
    const version = (t.version || "").trim()
    if (!version) continue
    const name = t.name.trim().toLowerCase()
    if (!name) continue
    if (!versions.has(name)) versions.set(name, version)
  }
  return versions
}

export function lookupInstalledTemplateVersion(
  catalogName: string,
  ludusTemplates: Iterable<{ name: string; version?: string }>,
  versions: Map<string, string>,
): string | undefined {
  const catalog = catalogName.trim().toLowerCase()
  if (!catalog) return undefined
  for (const t of ludusTemplates) {
    const n = t.name.trim().toLowerCase()
    if (!n) continue
    if (n === catalog || n === `${catalog}-template` || catalog === `${n}-template`) {
      return versions.get(n) || t.version?.trim() || undefined
    }
    if (n.startsWith(`${catalog}-`) && n.endsWith("-template")) {
      return versions.get(n) || t.version?.trim() || undefined
    }
  }
  return versions.get(catalog)
}

export function sourceCatalogTemplateInstallState(
  row: { name: string; version?: string; state?: string },
  present: boolean,
  installedVersion?: string,
): CatalogInstallState {
  return resolveCatalogInstallState({
    present,
    catalogState: row.state,
    catalogVersion: row.version,
    installedVersion,
  })
}
