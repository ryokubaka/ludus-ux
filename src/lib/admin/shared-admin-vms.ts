import "server-only"

import { mapWithConcurrency } from "@/lib/core/concurrency"
import { TtlCache } from "@/lib/core/server-cache"
import { sshExec } from "@/lib/ssh/proxmox-ssh"

export interface SharedAdminVM {
  vmid: number
  name: string
  node: string
  status: "running" | "stopped" | "unknown"
  ip: string
  serviceType: "nexus" | "share" | "other"
}

export interface SharedAdminVmSshCreds {
  sshHost: string
  sshPort: number
  sshUser: string
  sshPass: string
}

const CACHE_TTL_MS = 10_000
const MAX_PARALLEL_VMS = 4

const cache = new TtlCache<SharedAdminVM[]>(CACHE_TTL_MS, 8)

function cacheKey(creds: SharedAdminVmSshCreds): string {
  return `${creds.sshHost}:${creds.sshPort}:${creds.sshUser}`
}

/**
 * Discover VMs in Proxmox's ADMIN pool. The previous implementation resolved
 * `/nodes` inside the per-VM loop and awaited status + guest agent serially.
 * Resolve nodes once, then run per-VM reads with a small worker pool.
 */
export async function discoverSharedAdminVms(
  creds: SharedAdminVmSshCreds,
): Promise<SharedAdminVM[]> {
  const { sshHost, sshPort, sshUser, sshPass } = creds

  let members: Array<{ vmid: number; node?: string; type?: string }> = []
  try {
    const poolJson = await sshExec(
      sshHost, sshPort, sshUser, sshPass,
      ["pvesh", "get", "/pools/ADMIN", "--output-format", "json"],
    )
    const pool = JSON.parse(poolJson) as { members?: Array<{ vmid: number; node?: string; type?: string }> }
    members = (pool.members || []).filter((m) => m.type === "qemu" || !m.type)
  } catch (err) {
    // An empty pool is a real result. A failed SSH read must throw so the
    // caller can keep the last good list instead of caching a blank one.
    throw err instanceof Error ? err : new Error("Could not list the ADMIN pool")
  }

  if (members.length === 0) return []

  let fallbackNode = "pve"
  if (members.some((m) => !m.node)) {
    try {
      const nodesJson = await sshExec(
        sshHost, sshPort, sshUser, sshPass,
        ["pvesh", "get", "/nodes", "--output-format", "json"],
      )
      const nodes = JSON.parse(nodesJson) as Array<{ node: string }>
      fallbackNode = nodes[0]?.node ?? "pve"
    } catch {
      fallbackNode = "pve"
    }
  }

  return mapWithConcurrency(members, MAX_PARALLEL_VMS, async (member) => {
    const { vmid } = member
    const node = member.node || fallbackNode
    let name = `vmid-${vmid}`
    let status: SharedAdminVM["status"] = "unknown"
    let ip = ""

    const [statusRead, netRead] = await Promise.allSettled([
      sshExec(
        sshHost, sshPort, sshUser, sshPass,
        ["pvesh", "get", `/nodes/${node}/qemu/${vmid}/status/current`, "--output-format", "json"],
      ),
      sshExec(
        sshHost, sshPort, sshUser, sshPass,
        ["pvesh", "get", `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`, "--output-format", "json"],
      ),
    ])

    if (statusRead.status === "fulfilled") {
      try {
        const s = JSON.parse(statusRead.value) as { name?: string; status?: string }
        name = s.name ?? name
        status = s.status === "running" ? "running" : s.status === "stopped" ? "stopped" : "unknown"
      } catch {
        /* leave defaults */
      }
    }

    if (netRead.status === "fulfilled") {
      try {
        const net = JSON.parse(netRead.value) as {
          result?: Array<{ "ip-addresses"?: Array<{ "ip-address"?: string; "ip-address-type"?: string }> }>
        }
        for (const iface of net.result ?? []) {
          for (const addr of iface["ip-addresses"] ?? []) {
            const a = addr["ip-address"] ?? ""
            if (addr["ip-address-type"] === "ipv4" && !a.startsWith("127.") && !a.startsWith("169.254")) {
              ip = a
              break
            }
          }
          if (ip) break
        }
      } catch {
        /* no IP available */
      }
    }

    let serviceType: SharedAdminVM["serviceType"] = "other"
    if (/nexus/i.test(name)) serviceType = "nexus"
    else if (/(^|-)share($|-)/i.test(name) || /ludus.?share/i.test(name)) serviceType = "share"

    return { vmid, name, node, status, ip, serviceType }
  })
}

/**
 * Cached discovery for `/api/admin/shared-vms`. A manual refresh (`force`)
 * clears the entry before reading; a failed refresh keeps the last good list
 * rather than blanking the admin table.
 */
export interface SharedAdminVmsLoadResult {
  vms: SharedAdminVM[]
  cacheStatus: "hit" | "miss" | "stale" | "shared"
  /** Time spent waiting on SSH for a miss/shared read; 0 on a hit. */
  readMs: number
}

export async function loadSharedAdminVmsWithMeta(
  creds: SharedAdminVmSshCreds,
  opts?: { force?: boolean },
): Promise<SharedAdminVmsLoadResult> {
  const key = cacheKey(creds)
  if (opts?.force) cache.invalidate(key)
  const result = await cache.resolveWithStatus(
    key,
    () => discoverSharedAdminVms(creds),
    { staleOnError: true },
  )
  return {
    vms: result.value,
    cacheStatus: result.status,
    readMs: result.fetchMs,
  }
}

export async function loadSharedAdminVms(
  creds: SharedAdminVmSshCreds,
  opts?: { force?: boolean },
): Promise<SharedAdminVM[]> {
  return (await loadSharedAdminVmsWithMeta(creds, opts)).vms
}
