import type { AnsibleItem, BlueprintListItem } from "@/lib/types"
import { sourceBlueprintInstallId } from "@/lib/registered-ludus-sources"

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

export function isAnsibleCatalogNameInstalled(name: string, installed: Set<string>): boolean {
  return ansibleCatalogNameKeys(name).some((key) => installed.has(key))
}

export function isSourceCatalogAnsibleInstalled(
  row: { state?: string; name?: string; fqcn?: string },
  installed: Set<string>,
): boolean {
  if (row.state === "installed" || row.state === "upgrade_available") return true
  const names = [row.fqcn, row.name].filter(Boolean) as string[]
  return names.some((n) => isAnsibleCatalogNameInstalled(n, installed))
}

export function sourceCatalogAnsibleInstallState(
  row: { state?: string; name?: string; fqcn?: string },
  installed: Set<string>,
): "installed" | "not_installed" {
  return isSourceCatalogAnsibleInstalled(row, installed) ? "installed" : "not_installed"
}
