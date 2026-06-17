import type { BlueprintListItem } from "@/lib/types"
import { blueprintShortName } from "@/lib/registered-ludus-sources"
import { isGlobalSourceCatalogBlueprint } from "@/lib/blueprint-list-normalize"

export interface BlueprintListGate {
  isAdmin: boolean
  sessionUsername: string | null
  ludusUserId: string | null
  blueprintOperatorUserId?: string | null
}

export interface ConsolidatedBlueprint {
  primaryId: string
  typeKey: string
  displayName: string
  description?: string
  blueprint: BlueprintListItem
  aliasIds: string[]
  aliasCount: number
  isSourceCatalog: boolean
}

/** Folder slug used to group source-installed blueprints (`goad`, `ad-elastic-range`, …). */
export function blueprintTypeKey(bp: BlueprintListItem): string {
  const id = (bp.id || bp.blueprintID || "").trim()
  if (!id) return ""
  const slash = id.lastIndexOf("/")
  if (slash >= 0) return id.slice(slash + 1).toLowerCase()
  const short = blueprintShortName({ id, name: bp.name })
  if (/^[a-zA-Z0-9._-]+$/.test(short)) return short.toLowerCase()
  return id.toLowerCase()
}

function scoreBlueprint(bp: BlueprintListItem, gate?: BlueprintListGate): number {
  let score = 0
  const id = bp.id || bp.blueprintID || ""
  const isSource = isGlobalSourceCatalogBlueprint(bp, gate)
  const uid = (gate?.ludusUserId || "").toLowerCase().trim()
  const sun = (gate?.sessionUsername || "").toLowerCase().trim()
  const owner = (bp.ownerID || "").toLowerCase().trim()

  const operator = (gate?.blueprintOperatorUserId || "").toLowerCase().trim()

  if (isSource) {
    if (operator && owner === operator) score += 400
    if (owner === "root") score += 300
    if (gate?.isAdmin && owner && (owner === uid || owner === sun)) score += 250
    if (id.startsWith("ludus-source-bsl/")) score += 120
    if (bp.access === "owner" && gate?.isAdmin) score += 30
  } else if (owner && (owner === uid || owner === sun)) {
    score += 100
  }

  if (bp.access === "owner") score += 15
  if (bp.access === "admin") score += 10
  const updated = Date.parse(String(bp.updatedAt || bp.updated || ""))
  if (Number.isFinite(updated)) score += updated / 1e15
  return score
}

/** One row per blueprint type — collapse duplicate source installs that share the same folder slug. */
export function consolidateBlueprintList(
  blueprints: BlueprintListItem[],
  gate?: BlueprintListGate,
): ConsolidatedBlueprint[] {
  const groups = new Map<string, BlueprintListItem[]>()
  for (const bp of blueprints) {
    const key = blueprintTypeKey(bp)
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(bp)
    groups.set(key, list)
  }

  const consolidated: ConsolidatedBlueprint[] = []
  for (const [typeKey, members] of groups) {
    const sorted = [...members].sort((a, b) => scoreBlueprint(b, gate) - scoreBlueprint(a, gate))
    const primary = sorted[0]!
    const primaryId = (primary.id || primary.blueprintID || "").trim()
    if (!primaryId) continue
    const aliasIds = sorted
      .slice(1)
      .map((b) => (b.id || b.blueprintID || "").trim())
      .filter(Boolean)
    consolidated.push({
      primaryId,
      typeKey,
      displayName: primary.name?.trim() || typeKey,
      description: primary.description,
      blueprint: primary,
      aliasIds,
      aliasCount: aliasIds.length,
      isSourceCatalog: isGlobalSourceCatalogBlueprint(primary, gate),
    })
  }

  return consolidated.sort((a, b) => a.typeKey.localeCompare(b.typeKey))
}
