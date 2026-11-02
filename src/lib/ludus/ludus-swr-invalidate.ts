import "server-only"

import { bustAdminCache } from "@/lib/admin/admin-data"
import { bustRangeVmsCache } from "@/lib/admin/admin-range-vms-cache"
import { invalidatePrefetchSwrCaches } from "@/lib/core/server-prefetch"

/**
 * Drop in-process SWRCache entries after Ludus mutations so the next navigation
 * or admin API call does not serve a stale VM list from L1 while L2 tags refresh.
 */
export function invalidateInProcessLudusCachesAfterMutation(apiKey?: string): void {
  bustAdminCache(apiKey)
  bustRangeVmsCache(apiKey)
  invalidatePrefetchSwrCaches()
}
