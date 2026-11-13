import "server-only"

import type { ResolvedSession } from "@/lib/session/session-edge"
import { effectiveScopeTagFromSession } from "@/lib/session/effective-scope"
import {
  revalidateLudusAdminMutation,
  revalidateLudusResource,
  revalidateLudusScopeResource,
} from "@/lib/ludus/ludus-cache-revalidate"
import type { LudusRangeCacheResource } from "@/lib/ludus/ludus-cache-tags"
import { ludusRangeCacheTag, ludusRangeIdCacheTag } from "@/lib/ludus/ludus-cache-tags"
import { revalidateTag } from "next/cache"
import { invalidateInProcessLudusCachesAfterMutation } from "@/lib/ludus/ludus-swr-invalidate"

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

const RANGE_RESOURCES: LudusRangeCacheResource[] = [
  "rangeStatus",
  "rangeLogHistory",
  "rangeLogEnrichment",
  "snapshots",
  "rangeConfig",
]

/**
 * Invalidate range data for the acting scope only. A known range ID busts that
 * range's tags; without one, the scope-wide tags cover every range in the
 * scope. Cross-scope readers pick up the change through the short `cacheLife`
 * TTL instead of a global revalidation herd.
 */
function revalidateRangeCaches(scopeTag: string, rangeId?: string | null): void {
  revalidateLudusScopeResource(scopeTag, "ranges")
  for (const resource of RANGE_RESOURCES) {
    revalidateTag(
      rangeId
        ? ludusRangeIdCacheTag(scopeTag, resource, rangeId)
        : ludusRangeCacheTag(scopeTag, resource),
      "max",
    )
  }
}

/**
 * Invalidate Next.js Ludus prefetch caches after a successful `/api/proxy` mutation.
 * ACL-wide catalog resources (users, groups, templates, blueprints, ansible) keep
 * their global tag so other scopes see the change. Range data is scoped to the
 * acting user and, when known, the single range that was mutated.
 */
export function revalidateAfterLudusProxyMutation(
  method: string,
  ludusPath: string,
  session: Pick<
    ResolvedSession,
    "username" | "impersonationUserId" | "apiKey" | "impersonationApiKey"
  >,
  rangeId?: string | null,
): void {
  if (!MUTATING.has(method.toUpperCase())) return

  const path = ludusPath.split("?")[0]
  const scopeTag = effectiveScopeTagFromSession(session)
  const apiKey = (session.impersonationApiKey || session.apiKey)?.trim()

  if (path.startsWith("/groups")) {
    revalidateLudusResource("groups")
    revalidateLudusScopeResource(scopeTag, "groups")
    invalidateInProcessLudusCachesAfterMutation(apiKey)
    return
  }

  if (path.startsWith("/blueprints")) {
    revalidateLudusResource("blueprints")
    revalidateLudusScopeResource(scopeTag, "blueprints")
    // Applying a blueprint writes that range's config. Other blueprint writes do not.
    if (/^\/blueprints\/[^/]+\/apply$/.test(path)) {
      revalidateRangeCaches(scopeTag, rangeId)
      invalidateInProcessLudusCachesAfterMutation(apiKey)
    }
    return
  }

  if (path.startsWith("/templates") || path.startsWith("/template/") || path === "/template") {
    revalidateLudusResource("templates")
    revalidateLudusScopeResource(scopeTag, "templates")
    return
  }

  if (path.startsWith("/ansible")) {
    revalidateLudusResource("ansible")
    revalidateLudusScopeResource(scopeTag, "ansible")
    return
  }

  if (path.startsWith("/user")) {
    revalidateLudusResource("users")
    revalidateLudusScopeResource(scopeTag, "users")
    revalidateLudusAdminMutation()
    invalidateInProcessLudusCachesAfterMutation(apiKey)
    return
  }

  if (path.startsWith("/range") || path.startsWith("/ranges") || path.startsWith("/snapshots")) {
    revalidateRangeCaches(scopeTag, rangeId)
    invalidateInProcessLudusCachesAfterMutation(apiKey)
    return
  }

  if (path.startsWith("/testing")) {
    revalidateRangeCaches(scopeTag, rangeId)
    invalidateInProcessLudusCachesAfterMutation(apiKey)
  }
}
