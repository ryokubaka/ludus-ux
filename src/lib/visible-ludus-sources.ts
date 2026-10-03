import type { LudusSourceRow } from "@/lib/ludus-source-client"

export type VisibleLudusSource = LudusSourceRow & {
  published: boolean
  sharedCatalog: boolean
}

function sourceRowId(row: LudusSourceRow): string {
  return (row.sourceID || row.id || "").trim()
}

/**
 * Ludus lists sources only for the user who registered them.
 * A published source is merged in for everyone else, and every row carries the LUX share flag.
 */
export function assembleVisibleSources(
  own: LudusSourceRow[],
  remote: LudusSourceRow[],
  publishedIds: Set<string>,
  includeShared: boolean,
): VisibleLudusSource[] {
  const ownIds = new Set(own.map(sourceRowId).filter(Boolean))
  const shared = includeShared
    ? remote
        .filter((row) => {
          const id = sourceRowId(row)
          return id && publishedIds.has(id.toLowerCase()) && !ownIds.has(id)
        })
        .map((row) => ({ ...row, sharedCatalog: true as const }))
    : []

  return [...own, ...shared].map((row) => {
    const id = sourceRowId(row)
    const sharedCatalog = "sharedCatalog" in row && row.sharedCatalog === true
    return {
      ...row,
      published: publishedIds.has(id.toLowerCase()),
      sharedCatalog,
    }
  })
}
