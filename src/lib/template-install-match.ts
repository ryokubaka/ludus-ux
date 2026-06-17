const TEMPLATE_NAME_SUFFIX = "-template"

function norm(name: string): string {
  return name.trim().toLowerCase()
}

/** Ludus registers templates as `*-template`; source catalogs often use directory names. */
export function templateCatalogNamesForInstalled(installedName: string): string[] {
  const n = norm(installedName)
  if (!n) return []
  if (n.endsWith(TEMPLATE_NAME_SUFFIX)) {
    const base = n.slice(0, -TEMPLATE_NAME_SUFFIX.length)
    return [n, base]
  }
  return [n, `${n}${TEMPLATE_NAME_SUFFIX}`]
}

export function isTemplateCatalogNameInstalled(
  catalogName: string,
  installedNames: Iterable<string>,
): boolean {
  const candidates = new Set(templateCatalogNamesForInstalled(catalogName))
  for (const installed of installedNames) {
    if (candidates.has(norm(installed))) return true
  }
  return false
}

export function buildInstalledTemplateNameSet(installed: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const name of installed) {
    for (const alias of templateCatalogNamesForInstalled(name)) {
      out.add(alias)
    }
  }
  return out
}

/** Ludus has the template on disk; built means packer finished successfully. */
export type CatalogTemplatePresence = "none" | "added" | "built"

export function buildCatalogTemplatePresenceMap(
  ludusTemplates: Iterable<{ name: string; built: boolean }>,
): Map<string, CatalogTemplatePresence> {
  const out = new Map<string, CatalogTemplatePresence>()
  for (const t of ludusTemplates) {
    const presence: CatalogTemplatePresence = t.built ? "built" : "added"
    for (const alias of templateCatalogNamesForInstalled(t.name)) {
      const existing = out.get(alias)
      if (!existing || presence === "built") out.set(alias, presence)
    }
  }
  return out
}

export function getCatalogTemplatePresence(
  catalogName: string,
  presenceMap: Map<string, CatalogTemplatePresence>,
): CatalogTemplatePresence {
  for (const alias of templateCatalogNamesForInstalled(catalogName)) {
    const hit = presenceMap.get(alias)
    if (hit) return hit
  }
  return "none"
}
