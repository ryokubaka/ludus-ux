import type { SourceInstallSelection } from "@/lib/sources/ludus-source-client"

/** Catalog versions already on screen, so a re-sync can pin them without listing the repo again. */
export interface SourceCatalogVersionPins {
  catalogRef?: string
  blueprints?: Record<string, string>
  templates?: Record<string, string>
  localRoles?: Record<string, string>
  localCollections?: Record<string, string>
}

/** POST /api/sources/:id/install — set force to overwrite already-installed content. */
export async function postSourceInstall(
  sourceId: string,
  selection: SourceInstallSelection,
  options?: { force?: boolean; noDeps?: boolean; versions?: SourceCatalogVersionPins },
): Promise<{ warnings: string[]; data: unknown }> {
  const res = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selection,
      ...(options?.force ? { force: true } : {}),
      // Default: force re-sync skips blueprint ansible deps (see server).
      ...(options?.noDeps !== undefined ? { noDeps: options.noDeps } : {}),
      ...(options?.versions ? { versions: options.versions } : {}),
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    error?: string
    warnings?: string[]
    data?: unknown
  }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return { warnings: json.warnings ?? [], data: json.data }
}
