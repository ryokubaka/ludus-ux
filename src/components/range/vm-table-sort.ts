import type { VMObject } from "@/lib/core/types"

export type VmSortKey = "name" | "status" | "ip" | "vmid"
export type VmSortDir = "asc" | "desc"

export interface VmSort {
  key: VmSortKey
  dir: VmSortDir
}

/** Dashboard default: lowest address first. Missing addresses stay at the bottom. */
export const DEFAULT_VM_SORT: VmSort = { key: "ip", dir: "asc" }

/** First click on a column. Status starts with running machines first. The others start low-to-high. */
export function defaultDirForVmSort(key: VmSortKey): VmSortDir {
  return key === "status" ? "desc" : "asc"
}

/** IPv4 as an integer. Anything else, including "null", does not sort as an address. */
export function ipv4SortValue(ip: string | undefined | null): number | null {
  if (!ip || ip === "null") return null
  const parts = ip.trim().split(".")
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

export function compareVmRows(
  a: VMObject,
  b: VMObject,
  sort: VmSort,
  nameOf: (vm: VMObject) => string,
  runningOf: (vm: VMObject) => boolean,
): number {
  const byName = () => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base", numeric: true })
  let cmp = 0
  if (sort.key === "name") {
    cmp = byName()
  } else if (sort.key === "status") {
    cmp = Number(runningOf(a)) - Number(runningOf(b))
  } else if (sort.key === "vmid") {
    cmp = (a.proxmoxID || a.ID || 0) - (b.proxmoxID || b.ID || 0)
  } else {
    const aIp = ipv4SortValue(a.ip)
    const bIp = ipv4SortValue(b.ip)
    if (aIp == null && bIp == null) cmp = 0
    else if (aIp == null) return 1
    else if (bIp == null) return -1
    else cmp = aIp - bIp
  }
  if (cmp === 0) return byName()
  return sort.dir === "asc" ? cmp : -cmp
}
