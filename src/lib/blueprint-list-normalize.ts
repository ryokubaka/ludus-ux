import type { BlueprintListItem } from "@/lib/types"

function countOrArray(value: unknown): { count: number; ids?: string[] } {
  if (Array.isArray(value)) {
    const ids = value.map((v) => String(v).trim()).filter(Boolean)
    return { count: ids.length, ids }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { count: value }
  }
  return { count: 0 }
}

/** Map Ludus v2 blueprint list rows to LUX `BlueprintListItem` shape. */
export function normalizeBlueprintListItem(raw: unknown): BlueprintListItem | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const id = String(row.blueprintID ?? row.id ?? "").trim()
  if (!id) return null

  const sharedUsers = countOrArray(row.sharedUsers)
  const sharedGroups = countOrArray(row.sharedGroups)
  const accessRaw = row.accessType ?? row.access
  const access =
    accessRaw == null || accessRaw === ""
      ? undefined
      : (String(accessRaw) as BlueprintListItem["access"])

  return {
    id,
    blueprintID: id,
    name: row.name != null ? String(row.name) : undefined,
    description: row.description != null ? String(row.description) : undefined,
    ownerID: String(row.ownerUserID ?? row.ownerID ?? "").trim() || undefined,
    access,
    sharedUsers: sharedUsers.count,
    sharedUserIds: sharedUsers.ids,
    sharedGroups: sharedGroups.count,
    sharedGroupNames: sharedGroups.ids,
    sourceID: row.sourceID != null ? String(row.sourceID) : undefined,
    updatedAt: row.updatedAt != null ? String(row.updatedAt) : undefined,
    created: row.created != null ? String(row.created) : undefined,
    updated: row.updated != null ? String(row.updated) : undefined,
  }
}

export function normalizeBlueprintList(data: unknown): BlueprintListItem[] {
  if (!Array.isArray(data)) {
    if (data && typeof data === "object") {
      const wrapped = data as Record<string, unknown>
      for (const key of ["result", "blueprints", "items", "data"]) {
        const inner = wrapped[key]
        if (Array.isArray(inner)) return normalizeBlueprintList(inner)
      }
    }
    return []
  }
  const out: BlueprintListItem[] = []
  for (const row of data) {
    const bp = normalizeBlueprintListItem(row)
    if (bp) out.push(bp)
  }
  return out
}

/** Source-catalog installs use `sourceKey/slug` IDs (e.g. `ludus-source-bsl/goad`). */
export function isSourceCatalogBlueprintId(blueprintId: string): boolean {
  const id = blueprintId.trim()
  if (!id.includes("/")) return false
  const slug = id.slice(id.lastIndexOf("/") + 1)
  return /^[a-zA-Z0-9._-]+$/.test(slug)
}

export function blueprintFolderSlug(blueprintId: string): string {
  const id = blueprintId.trim()
  const slash = id.lastIndexOf("/")
  return slash >= 0 ? id.slice(slash + 1) : id
}

export type BlueprintScopeGate = {
  isAdmin?: boolean
  sessionUsername?: string | null
  ludusUserId?: string | null
  blueprintOperatorUserId?: string | null
}

/**
 * User duplicate of a source blueprint (Ludus copy API) — not the admin global install.
 * Ludus names copies with a `-copy` slug suffix and "(Copy)" in the display name.
 */
export function isLikelyUserBlueprintCopy(
  bp: Pick<BlueprintListItem, "id" | "blueprintID" | "name" | "ownerID" | "sourceID">,
): boolean {
  const id = (bp.id || bp.blueprintID || "").trim()
  const hasSourceShape = isSourceCatalogBlueprintId(id) || !!bp.sourceID?.trim()
  if (!hasSourceShape) return false

  const slug = blueprintFolderSlug(id).toLowerCase()
  if (slug.endsWith("-copy") || slug.endsWith("_copy")) return true
  if (/\(copy\)/i.test(bp.name || "")) return true

  return false
}

/** Admin-installed global source row — not a user's private copy from the Copy action. */
export function isGlobalSourceCatalogBlueprint(
  bp: Pick<BlueprintListItem, "id" | "blueprintID" | "sourceID" | "name" | "ownerID">,
  gate?: BlueprintScopeGate,
): boolean {
  const id = (bp.id || bp.blueprintID || "").trim()
  if (!isSourceCatalogBlueprintId(id) && !bp.sourceID?.trim()) return false
  if (isLikelyUserBlueprintCopy(bp)) return false
  return true
}

export function isSourceCatalogBlueprint(bp: Pick<BlueprintListItem, "id" | "blueprintID" | "sourceID">): boolean {
  const id = (bp.id || bp.blueprintID || "").trim()
  if (bp.sourceID?.trim()) return true
  return isSourceCatalogBlueprintId(id)
}
