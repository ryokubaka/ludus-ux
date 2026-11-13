import {
  blueprintShortName,
  installedBlueprintMatchesSource,
  sourceBlueprintInstallId,
} from "@/lib/sources/registered-ludus-sources"
import type { BlueprintPaletteItem } from "./builder-types"

export interface SourceBlueprintGroup {
  sourceId: string
  sourceLabel: string
  items: Array<{
    name?: string
    description?: string
    sourceBlueprintID?: string
    id?: string
  }>
}

export interface InstalledBlueprintRef {
  id: string
  name?: string
  description?: string
}

function displayName(row: SourceBlueprintGroup["items"][number]): string {
  const name = row.name?.trim() ?? ""
  if (name && !name.includes("/")) return name
  return blueprintShortName(row)
}

/**
 * Palette rows come from loaded Ludus sources. An installed blueprint with the
 * same source id and short name is the same row, not a second copy. Blueprints
 * that were created on the host and do not belong to a source stay at the end.
 */
export function blueprintPaletteFromSources(
  groups: readonly SourceBlueprintGroup[],
  installed: readonly InstalledBlueprintRef[],
): BlueprintPaletteItem[] {
  const claimed = new Set<string>()
  const items: BlueprintPaletteItem[] = []
  const sorted = [...groups].sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel))
  for (const group of sorted) {
    const rows = [...group.items].sort((a, b) => displayName(a).localeCompare(displayName(b)))
    for (const row of rows) {
      const installName = blueprintShortName(row)
      if (!installName) continue
      const installId = sourceBlueprintInstallId(row, group.sourceId)
      if (!installId) continue
      const installedHit = installed.find((blueprint) =>
        installedBlueprintMatchesSource(blueprint.id, installName, group.sourceId),
      )
      const id = installedHit?.id ?? installId
      if (items.some((item) => item.id === id)) continue
      if (installedHit) claimed.add(installedHit.id)
      const description = row.description?.trim()
      items.push({
        id,
        name: displayName(row) || installName,
        description: description || undefined,
        sourceLabel: group.sourceLabel,
        sourceId: group.sourceId,
        installName,
        installedId: installedHit?.id,
      })
    }
  }

  const host = installed
    .filter((blueprint) => blueprint.id && !claimed.has(blueprint.id))
    .map((blueprint) => ({
      id: blueprint.id,
      name: blueprint.name?.trim() || blueprint.id,
      description: blueprint.description?.trim() || undefined,
      sourceLabel: "On this host",
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...items, ...host]
}
