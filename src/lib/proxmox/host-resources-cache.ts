/**
 * Process-level cache for the dashboard's Ludus host CPU/memory card.
 *
 * `pvesh /cluster/resources` over SSH takes seconds, and every dashboard reload
 * used to wait on it. The cache serves the last verified snapshot immediately
 * and revalidates in the background. The first request after a cold start still
 * waits for one SSH read; after that no request blocks on SSH.
 *
 * The snapshot is global (cluster-wide, not per user). Route auth still gates
 * access; the cache only avoids repeating the same host read for each viewer.
 */

import "server-only"

import type { HostResourceNode, HostResourcesPayload, HostResourcesSnapshot } from "@/lib/proxmox/host-resources"
import { parseClusterResourceNodes } from "@/lib/proxmox/proxmox-node-metrics-parse"
import { requireProxmoxSsh } from "@/lib/ssh/root-ssh-auth"
import { sshExec } from "@/lib/ssh/proxmox-ssh"
import { recordCacheAccess } from "@/lib/core/cache-metrics"

/** Re-read the host when the snapshot is older than this. */
const REFRESH_MS = 15_000

/** Do not start another SSH read sooner than this after a failure. */
const RETRY_MS = 10_000

export interface HostResourcesCache {
  /**
   * Blocking only on cold start. Afterwards returns the cached snapshot and
   * starts a background refresh when it is stale.
   */
  get(): Promise<HostResourcesPayload | null>
  /** Same as `get`, plus the cache outcome and time spent waiting on a read. */
  getWithMeta(): Promise<HostResourcesRead>
  /** Non-blocking SSR read; returns null and starts a refresh when empty. */
  peek(): HostResourcesPayload | null
  /** Last refresh error, used for the 503 body when no snapshot exists. */
  lastError(): string | null
  /** Resolves when an in-flight refresh settles (tests and shutdown checks). */
  idle(): Promise<void>
}

export interface HostResourcesRead {
  payload: HostResourcesPayload | null
  cacheStatus: "hit" | "miss" | "stale"
  /** Time spent waiting on SSH for a miss; 0 when a snapshot was served. */
  readMs: number
}

export function createHostResourcesCache(options: {
  read: () => Promise<HostResourceNode[]>
  now?: () => number
  refreshMs?: number
  retryMs?: number
}): HostResourcesCache {
  const now = options.now ?? (() => Date.now())
  const refreshMs = options.refreshMs ?? REFRESH_MS
  const retryMs = options.retryMs ?? RETRY_MS

  let snapshot: HostResourcesSnapshot | null = null
  let lastError: string | null = null
  let lastAttemptAt = 0
  let inflight: Promise<void> | null = null

  function payload(): HostResourcesPayload | null {
    if (!snapshot) return null
    return {
      capturedAt: snapshot.capturedAt,
      nodes: snapshot.nodes,
      refreshing: inflight !== null,
      ...(lastError ? { error: lastError } : {}),
    }
  }

  function refresh(force: boolean): Promise<void> {
    if (inflight) return inflight
    const at = now()
    if (!force && lastAttemptAt > 0 && at - lastAttemptAt < retryMs) {
      return Promise.resolve()
    }
    lastAttemptAt = at
    inflight = options
      .read()
      .then((nodes) => {
        snapshot = { capturedAt: now(), nodes }
        lastError = null
      })
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err)
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  function recentlyFailed(): boolean {
    return lastError != null && lastAttemptAt > 0 && now() - lastAttemptAt < retryMs
  }

  return {
    async getWithMeta() {
      const start = performance.now()
      if (!snapshot) {
        if (!recentlyFailed()) await refresh(true)
        const payloadValue = payload()
        recordCacheAccess("host-resources", "miss")
        return { payload: payloadValue, cacheStatus: "miss", readMs: performance.now() - start }
      }
      const stale = now() - snapshot.capturedAt >= refreshMs
      if (stale) void refresh(false)
      recordCacheAccess("host-resources", stale ? "stale" : "hit")
      return {
        payload: payload(),
        cacheStatus: stale ? "stale" : "hit",
        readMs: 0,
      }
    },
    async get() {
      return (await this.getWithMeta()).payload
    },
    peek() {
      if (!snapshot) {
        recordCacheAccess("host-resources", "miss")
        void refresh(false)
        return null
      }
      const stale = now() - snapshot.capturedAt >= refreshMs
      recordCacheAccess("host-resources", stale ? "stale" : "hit")
      if (stale) void refresh(false)
      return payload()
    },
    lastError: () => lastError,
    async idle() {
      if (inflight) await inflight
    },
  }
}

async function readHostResourcesFromHost(): Promise<HostResourceNode[]> {
  const ssh = requireProxmoxSsh()
  if (!ssh.ok) throw new Error(ssh.error)
  const { sshHost, sshPort, sshUser, sshPass } = ssh.creds

  const resourcesJson = await sshExec(
    sshHost,
    sshPort,
    sshUser,
    sshPass,
    ["pvesh", "get", "/cluster/resources", "--output-format", "json"],
  )
  const parsed = parseClusterResourceNodes(resourcesJson)
  const nodes = [...parsed.entries()]
    .map(([name, sample]) => ({ name, ...sample }))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!nodes.length) throw new Error("No Proxmox nodes returned from pvesh")
  return nodes
}

const hostResourcesCache = createHostResourcesCache({ read: readHostResourcesFromHost })

export const getHostResourcesPayload = () => hostResourcesCache.get()
export const getHostResourcesWithMeta = () => hostResourcesCache.getWithMeta()
export const peekHostResourcesPayload = () => hostResourcesCache.peek()
export const hostResourcesLastError = () => hostResourcesCache.lastError()
