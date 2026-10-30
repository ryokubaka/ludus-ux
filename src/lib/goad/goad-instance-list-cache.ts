import type { QueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/ui/query-keys"

export type GoadListMatch = { instanceId?: string; rangeId?: string }

type GoadListIdentity = { instanceId?: string; ludusRangeId?: string }

function isGoadListIdentity(value: unknown): value is GoadListIdentity {
  return !!value && typeof value === "object" && "instanceId" in value
}

export function goadListEntryMatches(entry: GoadListIdentity, match: GoadListMatch): boolean {
  if (match.instanceId && entry.instanceId === match.instanceId) return true
  if (match.rangeId && entry.ludusRangeId === match.rangeId) return true
  return false
}

/** Drop a deleted instance from either list shape: an instance array, or `{ instances }`. */
export function withoutGoadListEntries<T>(current: T, match: GoadListMatch): T {
  if (!match.instanceId && !match.rangeId) return current
  if (Array.isArray(current)) {
    if (current.some((row) => !isGoadListIdentity(row))) return current
    return current.filter((row) => isGoadListIdentity(row) && !goadListEntryMatches(row, match)) as T
  }
  if (
    current &&
    typeof current === "object" &&
    "instances" in current &&
    Array.isArray((current as { instances: unknown }).instances)
  ) {
    const row = current as { instances: unknown[] }
    if (row.instances.some((item) => !isGoadListIdentity(item))) return current
    return {
      ...row,
      instances: row.instances.filter((item) => isGoadListIdentity(item) && !goadListEntryMatches(item, match)),
    } as T
  }
  return current
}

/**
 * Remove the instance from every cached GOAD list, then refetch.
 * The list page keeps the previous payload for up to two minutes, so a delete
 * has to edit that payload before navigation or the deleted range stays on screen.
 */
export function dropGoadInstanceFromCache(
  queryClient: QueryClient,
  match: GoadListMatch,
): Promise<void> {
  if (!match.instanceId && !match.rangeId) return Promise.resolve()
  queryClient.setQueriesData({ queryKey: queryKeys.goadInstances() }, (current) =>
    withoutGoadListEntries(current, match),
  )
  if (match.rangeId) {
    queryClient.removeQueries({
      predicate: (query) =>
        query.queryKey.includes("by-range") && query.queryKey.includes(match.rangeId),
    })
  }
  return queryClient.invalidateQueries({ queryKey: queryKeys.goadInstances() })
}
