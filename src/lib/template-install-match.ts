const TEMPLATE_NAME_SUFFIX = "-template"

function norm(name: string): string {
  return name.trim().toLowerCase()
}

function stripTemplateSuffix(name: string): string {
  return name.endsWith(TEMPLATE_NAME_SUFFIX)
    ? name.slice(0, -TEMPLATE_NAME_SUFFIX.length)
    : name
}

/**
 * Catalog dirs are often shorter than Ludus Packer names, e.g.
 * `securityonion-3` → `securityonion-3-x64-template`.
 */
export function catalogMatchesInstalledName(catalogName: string, installedName: string): boolean {
  const catalog = norm(catalogName)
  const installed = norm(installedName)
  if (!catalog || !installed) return false
  if (catalog === installed) return true
  if (installed === `${catalog}${TEMPLATE_NAME_SUFFIX}`) return true
  if (catalog === `${installed}${TEMPLATE_NAME_SUFFIX}`) return true

  const installedBase = stripTemplateSuffix(installed)
  if (installedBase === catalog) return true
  // Prefix + hyphen: securityonion-3 ↔ securityonion-3-x64[-template]
  if (installedBase.startsWith(`${catalog}-`)) return true
  return false
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
  for (const installed of installedNames) {
    if (catalogMatchesInstalledName(catalogName, installed)) return true
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
    // Keep full Ludus name so prefix matching can find securityonion-3-x64-template
    const full = norm(t.name)
    if (full) {
      const existing = out.get(full)
      if (!existing || presence === "built") out.set(full, presence)
    }
  }
  return out
}

/** Resolve which Ludus template name a catalog entry maps to (for UI hints). */
export function resolveInstalledTemplateName(
  catalogName: string,
  ludusTemplates: Iterable<{ name: string }>,
): string | null {
  const catalog = norm(catalogName)
  if (!catalog) return null
  let hit: string | null = null
  for (const t of ludusTemplates) {
    if (!catalogMatchesInstalledName(catalog, t.name)) continue
    // Prefer longer / more specific Ludus names when several match
    if (!hit || t.name.length > hit.length) hit = t.name
  }
  return hit
}

export function getCatalogTemplatePresence(
  catalogName: string,
  presenceMap: Map<string, CatalogTemplatePresence>,
): CatalogTemplatePresence {
  const catalog = norm(catalogName)
  if (!catalog) return "none"

  let best: CatalogTemplatePresence = "none"
  for (const [key, presence] of presenceMap) {
    if (!catalogMatchesInstalledName(catalog, key)) continue
    if (presence === "built") return "built"
    if (best === "none") best = presence
  }
  return best
}
