import { SWRCache } from "@/lib/server-cache"
import type { RangeVmInventoryRow } from "@/lib/range-vm-inventory"

const rangeVmsCache = new SWRCache<{ vms: RangeVmInventoryRow[]; ts: number }>(30_000)

export function getRangeVmsCache(): SWRCache<{ vms: RangeVmInventoryRow[]; ts: number }> {
  return rangeVmsCache
}

export function bustRangeVmsCache(apiKey?: string): void {
  if (apiKey?.trim()) {
    rangeVmsCache.invalidate(`range-vms:${apiKey.trim()}`)
    return
  }
  rangeVmsCache.invalidate()
}
