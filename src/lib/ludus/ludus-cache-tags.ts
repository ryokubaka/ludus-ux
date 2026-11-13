/**
 * Next.js cache tag helpers for Ludus-backed TanStack prefetch data.
 * Tags are scoped by effectiveScopeTag (login|view) — never include API keys.
 */

export type LudusCacheResource =
  | "ranges"
  | "version"
  | "users"
  | "templates"
  | "groups"
  | "blueprints"
  | "ansible"
  | "admin"

export function ludusCacheTag(scopeTag: string, resource: LudusCacheResource): string {
  return `ludus:${resource}:${scopeTag}`
}

/** Cross-scope invalidation tag (paired on every cached Ludus fetch). */
export function ludusGlobalCacheTag(resource: LudusCacheResource): string {
  return `ludus:${resource}`
}

export type LudusRangeCacheResource =
  | "rangeStatus"
  | "rangeLogHistory"
  | "rangeLogEnrichment"
  | "snapshots"
  | "rangeConfig"

/**
 * Scope-wide range tag. Paired with the per-range tag so a mutation without a
 * known range ID can still refresh everything in the acting scope.
 */
export function ludusRangeCacheTag(scopeTag: string, resource: LudusRangeCacheResource): string {
  return `ludus:${resource}:${scopeTag}`
}

/** Per-range tag: invalidating one range no longer busts every range in the scope. */
export function ludusRangeIdCacheTag(
  scopeTag: string,
  resource: LudusRangeCacheResource,
  rangeId: string,
): string {
  return `ludus:${resource}:${scopeTag}:${rangeId}`
}

export function ludusGlobalRangeCacheTag(resource: LudusRangeCacheResource): string {
  return `ludus:${resource}`
}
