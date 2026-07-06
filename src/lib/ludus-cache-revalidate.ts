import "server-only"

import { revalidateTag } from "next/cache"
import {
  ludusCacheTag,
  ludusGlobalCacheTag,
  type LudusCacheResource,
} from "@/lib/ludus-cache-tags"

/** Bust Next.js data cache for one resource across all scopes. */
export function revalidateLudusResource(resource: LudusCacheResource): void {
  revalidateTag(ludusGlobalCacheTag(resource), "max")
}

/** Bust Next.js data cache for one resource under a single effective scope. */
export function revalidateLudusScopeResource(
  scopeTag: string,
  resource: LudusCacheResource,
): void {
  revalidateTag(ludusCacheTag(scopeTag, resource), "max")
}

/** Admin/range mutations often affect multiple Ludus-backed lists. */
export function revalidateLudusAdminMutation(): void {
  for (const r of ["admin", "users", "ranges"] as const) {
    revalidateLudusResource(r)
  }
}

/** Source mutations (create, delete, sync, install) invalidate templates, blueprints, and ansible. */
export function revalidateAfterSourceMutation(scopeTag: string): void {
  revalidateLudusResource("templates")
  revalidateLudusResource("blueprints")
  revalidateLudusResource("ansible")
  revalidateLudusScopeResource(scopeTag, "templates")
  revalidateLudusScopeResource(scopeTag, "blueprints")
  revalidateLudusScopeResource(scopeTag, "ansible")
}
