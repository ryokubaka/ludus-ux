/**
 * Short-lived cache for the settings performance tab's Proxmox node sample.
 *
 * The tab used to issue two `pvesh` calls (plus one per node) every 4 seconds.
 * Samples are now served from an 8 s process cache so staggered admin tabs and
 * repeated reads share one SSH round trip. Expired entries are never served;
 * a cache miss waits for a fresh read.
 */

import "server-only"

import { TtlCache, type TtlCacheResolveStatus } from "@/lib/core/server-cache"
import { sshExec } from "@/lib/ssh/proxmox-ssh"
import {
  parseClusterResourceNodes,
  parseNodeList,
  parseNodeStatusLoad,
} from "@/lib/proxmox/proxmox-node-metrics-parse"

export interface ProxmoxNodeMetric {
  name: string
  cpuPct: number | null
  memPct: number | null
  load1: number | null
  error?: string
}

export interface ProxmoxNodeMetricsSample {
  capturedAt: number
  nodes: ProxmoxNodeMetric[]
}

export interface ProxmoxNodeMetricsSshCreds {
  sshHost: string
  sshPort: number
  sshUser: string
  sshPass: string
}

export interface ProxmoxNodeMetricsRead {
  sample: ProxmoxNodeMetricsSample
  cacheStatus: TtlCacheResolveStatus
  /** Time spent waiting on SSH for a miss/shared read; 0 on a hit. */
  readMs: number
}

const SAMPLE_TTL_MS = 8_000
const sampleCache = new TtlCache<ProxmoxNodeMetricsSample>(SAMPLE_TTL_MS, 4)

function sampleCacheKey(creds: ProxmoxNodeMetricsSshCreds): string {
  return `${creds.sshHost}:${creds.sshPort}:${creds.sshUser}`
}

async function readSample(creds: ProxmoxNodeMetricsSshCreds): Promise<ProxmoxNodeMetricsSample> {
  const { sshHost, sshPort, sshUser, sshPass } = creds

  const [nodeJson, resourcesJson] = await Promise.all([
    sshExec(sshHost, sshPort, sshUser, sshPass, ["pvesh", "get", "/nodes", "--output-format", "json"]),
    sshExec(
      sshHost,
      sshPort,
      sshUser,
      sshPass,
      ["pvesh", "get", "/cluster/resources", "--output-format", "json"],
    ),
  ])
  const nodeNames = parseNodeList(nodeJson)
  if (!nodeNames.length) throw new Error("No Proxmox nodes returned from pvesh")

  const resourceByNode = parseClusterResourceNodes(resourcesJson)
  const capturedAt = Date.now()

  const results = await Promise.all(
    nodeNames.map(async (name): Promise<ProxmoxNodeMetric> => {
      const fromResources = resourceByNode.get(name)
      try {
        const statusJson = await sshExec(
          sshHost,
          sshPort,
          sshUser,
          sshPass,
          ["pvesh", "get", `/nodes/${name}/status`, "--output-format", "json"],
        )
        return {
          name,
          cpuPct: fromResources?.cpuPct ?? null,
          memPct: fromResources?.memPct ?? null,
          load1: parseNodeStatusLoad(statusJson),
        }
      } catch (e) {
        return {
          name,
          cpuPct: fromResources?.cpuPct ?? null,
          memPct: fromResources?.memPct ?? null,
          load1: null,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
  )

  return { capturedAt, nodes: results }
}

/**
 * Read the current node sample. A fresh cached sample is returned without SSH;
 * otherwise concurrent callers share one read.
 */
export async function getProxmoxNodeMetricsSample(
  creds: ProxmoxNodeMetricsSshCreds,
): Promise<ProxmoxNodeMetricsRead> {
  const result = await sampleCache.resolveWithStatus(
    sampleCacheKey(creds),
    () => readSample(creds),
  )
  return {
    sample: result.value,
    cacheStatus: result.status,
    readMs: result.fetchMs,
  }
}
