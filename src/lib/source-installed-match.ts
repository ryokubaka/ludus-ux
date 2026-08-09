import type { SourceInstallSelection } from "@/lib/ludus-source-client"
import type { RegisteredLudusSource } from "@/lib/registered-ludus-sources"
import { registeredSourceLabel } from "@/lib/registered-ludus-sources"
import {
  ansibleCatalogNameKeys,
  catalogVersionsDiffer,
  effectiveInstalledVersion,
  lookupCatalogPinVersion,
  resolveCatalogInstallState,
  type CatalogInstallState,
} from "@/lib/source-catalog-presence"
import { catalogMatchesInstalledName } from "@/lib/template-install-match"

export type SourceArtifactKind = "role" | "collection" | "template" | "blueprint"

export interface SourceCatalogRef {
  sourceId: string
  name: string
  fqcn?: string
  version?: string
  state?: string
}

export interface InstalledSourceMatch {
  sourceId: string
  sourceUrl?: string
  sourceLabel: string
  catalogName: string
  catalogVersion?: string
  installedVersion?: string
  upgradeAvailable: boolean
  kind: SourceArtifactKind
  /** Selection for `postSourceInstall(..., { force: true })`. */
  selection: SourceInstallSelection
}

function sourceMeta(
  sourceId: string,
  sources: RegisteredLudusSource[],
): Pick<InstalledSourceMatch, "sourceId" | "sourceUrl" | "sourceLabel"> {
  const hit = sources.find((s) => s.id === sourceId)
  return {
    sourceId,
    sourceUrl: hit?.url?.trim() || undefined,
    sourceLabel: hit ? registeredSourceLabel(hit) : sourceId,
  }
}

function preferMatch(
  current: InstalledSourceMatch | undefined,
  next: InstalledSourceMatch,
): InstalledSourceMatch {
  if (!current) return next
  if (next.upgradeAvailable && !current.upgradeAvailable) return next
  return current
}

function ansibleKeysForCatalogRow(row: SourceCatalogRef): string[] {
  const keys = new Set<string>()
  for (const n of [row.fqcn, row.name]) {
    if (!n) continue
    for (const k of ansibleCatalogNameKeys(n)) keys.add(k)
  }
  return [...keys]
}

/** Map installed ansible name → best source catalog match. */
export function buildAnsibleSourceMatchMap(
  kind: "role" | "collection",
  catalogs: Array<{
    sourceId: string
    items: SourceCatalogRef[]
    pins?: Record<string, string>
  }>,
  sources: RegisteredLudusSource[],
  installed: Array<{ name: string; version?: string }>,
): Map<string, InstalledSourceMatch> {
  const out = new Map<string, InstalledSourceMatch>()
  for (const item of installed) {
    const name = item.name.trim()
    if (!name) continue
    const nameKeys = new Set(ansibleCatalogNameKeys(name))
    let best: InstalledSourceMatch | undefined
    for (const cat of catalogs) {
      for (const row of cat.items) {
        const rowKeys = ansibleKeysForCatalogRow(row)
        if (!rowKeys.some((k) => nameKeys.has(k))) continue
        const catalogName = row.fqcn || row.name
        const installedVersion = effectiveInstalledVersion(
          item.version,
          lookupCatalogPinVersion(catalogName, cat.pins) ||
            lookupCatalogPinVersion(row.name, cat.pins),
        )
        const state: CatalogInstallState = resolveCatalogInstallState({
          present: true,
          catalogState: row.state,
          catalogVersion: row.version,
          installedVersion,
        })
        const match: InstalledSourceMatch = {
          ...sourceMeta(cat.sourceId, sources),
          catalogName,
          catalogVersion: row.version,
          installedVersion,
          upgradeAvailable: state === "upgrade_available",
          kind,
          selection:
            kind === "role"
              ? { localRoles: [row.name || catalogName] }
              : { localCollections: [row.name || catalogName] },
        }
        best = preferMatch(best, match)
      }
    }
    if (best) {
      for (const k of nameKeys) out.set(k, best)
      out.set(name.toLowerCase(), best)
    }
  }
  return out
}

export function lookupAnsibleSourceMatch(
  map: Map<string, InstalledSourceMatch>,
  name: string,
): InstalledSourceMatch | undefined {
  for (const k of ansibleCatalogNameKeys(name)) {
    const hit = map.get(k)
    if (hit) return hit
  }
  return undefined
}

/** Map catalog/installed template name aliases → match. */
export function buildTemplateSourceMatchMap(
  catalogs: Array<{
    sourceId: string
    items: SourceCatalogRef[]
    pins?: Record<string, string>
  }>,
  sources: RegisteredLudusSource[],
  installed: Array<{ name: string; version?: string }>,
): Map<string, InstalledSourceMatch> {
  const out = new Map<string, InstalledSourceMatch>()
  for (const item of installed) {
    const installedName = item.name.trim()
    if (!installedName) continue
    let best: InstalledSourceMatch | undefined
    for (const cat of catalogs) {
      for (const row of cat.items) {
        if (!row.name || !catalogMatchesInstalledName(row.name, installedName)) continue
        const installedVersion = effectiveInstalledVersion(
          item.version,
          lookupCatalogPinVersion(row.name, cat.pins),
        )
        const state = resolveCatalogInstallState({
          present: true,
          catalogState: row.state,
          catalogVersion: row.version,
          installedVersion,
        })
        const match: InstalledSourceMatch = {
          ...sourceMeta(cat.sourceId, sources),
          catalogName: row.name,
          catalogVersion: row.version,
          installedVersion,
          upgradeAvailable: state === "upgrade_available",
          kind: "template",
          selection: { templates: [row.name] },
        }
        best = preferMatch(best, match)
      }
    }
    if (best) {
      out.set(installedName.toLowerCase(), best)
    }
  }
  return out
}

export function lookupTemplateSourceMatch(
  map: Map<string, InstalledSourceMatch>,
  name: string,
): InstalledSourceMatch | undefined {
  return map.get(name.trim().toLowerCase())
}

export function buildBlueprintSourceMatchMap(
  catalogs: Array<{
    sourceId: string
    items: SourceCatalogRef[]
    pins?: Record<string, string>
  }>,
  sources: RegisteredLudusSource[],
  installed: Array<{
    id: string
    name?: string
    sourceID?: string
    version?: string
  }>,
): Map<string, InstalledSourceMatch> {
  const out = new Map<string, InstalledSourceMatch>()
  for (const item of installed) {
    const id = item.id.trim()
    if (!id) continue
    const short = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id
    let best: InstalledSourceMatch | undefined

    // Prefer explicit sourceID join when present.
    const preferredSourceIds = new Set<string>()
    if (item.sourceID?.trim()) preferredSourceIds.add(item.sourceID.trim())
    if (id.includes("/")) {
      const prefix = id.slice(0, id.lastIndexOf("/"))
      if (prefix) preferredSourceIds.add(prefix)
    }

    for (const cat of catalogs) {
      if (preferredSourceIds.size > 0 && !preferredSourceIds.has(cat.sourceId)) {
        // Still allow match if catalog name equals short slug (source id shapes vary).
        const hasName = cat.items.some(
          (row) =>
            (row.name || "").trim() === short ||
            (row.name || "").endsWith(`/${short}`),
        )
        if (!hasName) continue
      }
      for (const row of cat.items) {
        const rowName = (row.name || "").trim()
        const rowShort = rowName.includes("/")
          ? rowName.slice(rowName.lastIndexOf("/") + 1)
          : rowName
        if (rowShort !== short && rowName !== id && rowName !== item.name) continue
        const installedVersion = effectiveInstalledVersion(
          item.version,
          lookupCatalogPinVersion(rowShort, cat.pins) ||
            lookupCatalogPinVersion(rowName, cat.pins),
        )
        const state = resolveCatalogInstallState({
          present: true,
          catalogState: row.state,
          catalogVersion: row.version,
          installedVersion,
        })
        // Also treat version-less catalog + Ludus upgrade via sourceID-only as installed-from-source.
        const match: InstalledSourceMatch = {
          ...sourceMeta(cat.sourceId, sources),
          catalogName: rowName || short,
          catalogVersion: row.version,
          installedVersion,
          upgradeAvailable:
            state === "upgrade_available" ||
            catalogVersionsDiffer(row.version, installedVersion),
          kind: "blueprint",
          selection: { blueprints: [rowShort || short] },
        }
        // If versions missing but we matched by source, still link repo (not upgrade).
        if (state === "installed" && !match.upgradeAvailable) {
          match.upgradeAvailable = false
        }
        best = preferMatch(best, match)
      }
    }

    // Fallback: sourceID alone → repo link without catalog row.
    if (!best && item.sourceID?.trim()) {
      const sid = item.sourceID.trim()
      best = {
        ...sourceMeta(sid, sources),
        catalogName: short,
        installedVersion: item.version,
        upgradeAvailable: false,
        kind: "blueprint",
        selection: { blueprints: [short] },
      }
    }

    if (best) {
      out.set(id.toLowerCase(), best)
      out.set(short.toLowerCase(), best)
    }
  }
  return out
}

export function lookupBlueprintSourceMatch(
  map: Map<string, InstalledSourceMatch>,
  id: string,
): InstalledSourceMatch | undefined {
  const key = id.trim().toLowerCase()
  if (!key) return undefined
  if (map.has(key)) return map.get(key)
  const short = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key
  return map.get(short)
}
