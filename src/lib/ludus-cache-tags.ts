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

/** Prefix for revalidateTag / updateTag to bust every resource under a scope. */
export function ludusScopeCachePrefix(scopeTag: string): string {
  return `ludus:${scopeTag}:`
}

export type LudusRangeCacheResource =
  | "rangeStatus"
  | "rangeLogHistory"
  | "rangeLogEnrichment"
  | "snapshots"
  | "rangeConfig"

export function ludusRangeCacheTag(scopeTag: string, resource: LudusRangeCacheResource): string {
  return `ludus:${resource}:${scopeTag}`
}

export function ludusGlobalRangeCacheTag(resource: LudusRangeCacheResource): string {
  return `ludus:${resource}`
}
