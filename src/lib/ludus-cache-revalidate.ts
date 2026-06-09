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
