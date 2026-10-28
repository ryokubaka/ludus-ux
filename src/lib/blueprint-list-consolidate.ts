import type { BlueprintListItem } from "@/lib/types"
import {
  blueprintShortName,
  blueprintSourcePrefix,
  sourceIdsAreSameRegistration,
} from "@/lib/registered-ludus-sources"
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

function blueprintIdOf(bp: BlueprintListItem): string {
  return (bp.id || bp.blueprintID || "").trim()
}

/** Split a shared slug into one cluster per source registration (branch refs stay apart). */
function clusterBySourceRegistration(members: BlueprintListItem[]): BlueprintListItem[][] {
  const clusters: BlueprintListItem[][] = []
  for (const bp of members) {
    const prefix = blueprintSourcePrefix(blueprintIdOf(bp))
    const cluster = clusters.find((group) =>
      sourceIdsAreSameRegistration(prefix, blueprintSourcePrefix(blueprintIdOf(group[0]!))),
    )
    if (cluster) cluster.push(bp)
    else clusters.push([bp])
  }
  return clusters
}

/** One row per source registration — collapse only userID-prefixed copies of the same source. */
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
    for (const cluster of clusterBySourceRegistration(members)) {
      pushConsolidated(consolidated, typeKey, cluster, gate)
    }
  }

  return consolidated.sort((a, b) => a.primaryId.localeCompare(b.primaryId))
}

function pushConsolidated(
  consolidated: ConsolidatedBlueprint[],
  typeKey: string,
  members: BlueprintListItem[],
  gate?: BlueprintListGate,
): void {
  const sorted = [...members].sort((a, b) => scoreBlueprint(b, gate) - scoreBlueprint(a, gate))
  const primary = sorted[0]!
  const primaryId = (primary.id || primary.blueprintID || "").trim()
  if (!primaryId) return
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
