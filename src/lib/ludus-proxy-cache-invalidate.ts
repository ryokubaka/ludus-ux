import "server-only"

import type { SessionData } from "@/lib/session-edge"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import {
  revalidateLudusAdminMutation,
  revalidateLudusResource,
  revalidateLudusScopeResource,
} from "@/lib/ludus-cache-revalidate"
import type { LudusRangeCacheResource } from "@/lib/ludus-cache-tags"
import { ludusGlobalRangeCacheTag } from "@/lib/ludus-cache-tags"
import { revalidateTag } from "next/cache"

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

function revalidateRangeCaches(scopeTag: string): void {
  revalidateLudusResource("ranges")
  revalidateLudusScopeResource(scopeTag, "ranges")
  const rangeResources: LudusRangeCacheResource[] = [
    "rangeStatus",
    "rangeLogHistory",
    "rangeLogEnrichment",
    "snapshots",
    "rangeConfig",
  ]
  for (const resource of rangeResources) {
    revalidateTag(ludusGlobalRangeCacheTag(resource), "max")
  }
}

/**
 * Invalidate Next.js Ludus prefetch caches after a successful `/api/proxy` mutation.
 * Uses global tags so all effective scopes refresh on the next navigation.
 */
export function revalidateAfterLudusProxyMutation(
  method: string,
  ludusPath: string,
  session: Pick<SessionData, "username" | "impersonationUserId">,
): void {
  if (!MUTATING.has(method.toUpperCase())) return

  const path = ludusPath.split("?")[0]
  const scopeTag = effectiveScopeTagFromSession(session)

  if (path.startsWith("/groups")) {
    revalidateLudusResource("groups")
    revalidateLudusScopeResource(scopeTag, "groups")
    return
  }

  if (path.startsWith("/blueprints")) {
    revalidateLudusResource("blueprints")
    revalidateLudusScopeResource(scopeTag, "blueprints")
    return
  }

  if (path.startsWith("/templates")) {
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
    return
  }

  if (path.startsWith("/range") || path.startsWith("/ranges") || path.startsWith("/snapshots")) {
    revalidateRangeCaches(scopeTag)
    return
  }

  if (path.startsWith("/testing")) {
    revalidateTag(ludusGlobalRangeCacheTag("rangeLogEnrichment"), "max")
    revalidateRangeCaches(scopeTag)
  }
}
