const SAFE_NODE = /^[a-zA-Z0-9._-]+$/

export function unwrapPveshJson(raw: string): unknown {
  const j = JSON.parse(raw) as unknown
  if (j && typeof j === "object" && "data" in j) {
    return (j as { data: unknown }).data
  }
  return j
}

export function parseNodeList(raw: string): string[] {
  const j = unwrapPveshJson(raw)
  const arr = Array.isArray(j) ? j : []
  const names: string[] = []
  for (const row of arr) {
    if (!row || typeof row !== "object") continue
    const n = (row as { node?: string }).node
    if (typeof n === "string" && SAFE_NODE.test(n)) names.push(n)
  }
  return names
}

function parseLoad1(loadavg: unknown): number | null {
  if (typeof loadavg === "string") {
    const first = loadavg.trim().split(/\s+/)[0]
    const v = parseFloat(first)
    return Number.isFinite(v) ? v : null
  }
  if (Array.isArray(loadavg) && loadavg.length > 0) {
    const v = parseFloat(String(loadavg[0]))
    return Number.isFinite(v) ? v : null
  }
  return null
}

/** Proxmox returns CPU as a 0–1 fraction (cluster/resources) or occasionally >1 as percent. */
export function fractionToPct(value: unknown): number | null {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : NaN
  if (!Number.isFinite(n)) return null
  const ratio = n > 1 ? n / 100 : n
  return Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10
}

export type NodeResourceSample = {
  cpuPct: number | null
  memPct: number | null
  memBytes: number | null
  maxMemBytes: number | null
  /** Proxmox `maxcpu` (core count). Used to weight a cluster CPU total. */
  maxCpu: number | null
}

export type ClusterResourceSample = {
  cpuPct: number | null
  memPct: number | null
  memBytes: number | null
  maxMemBytes: number | null
  nodeCount: number
}

/** CPU/mem from pvestatd via cluster/resources — reliable unlike /nodes/{node}/status cpu. */
export function parseClusterResourceNodes(raw: string): Map<string, NodeResourceSample> {
  const out = new Map<string, NodeResourceSample>()
  let inner: unknown
  try {
    inner = unwrapPveshJson(raw)
  } catch {
    return out
  }
  const arr = Array.isArray(inner) ? inner : []
  for (const row of arr) {
    if (!row || typeof row !== "object") continue
    const o = row as Record<string, unknown>
    if (o.type !== "node") continue
    const name = typeof o.node === "string" ? o.node : typeof o.name === "string" ? o.name : null
    if (!name || !SAFE_NODE.test(name)) continue

    let memPct: number | null = null
    let memBytes: number | null = null
    let maxMemBytes: number | null = null
    let maxCpu: number | null = null
    const maxmem = o.maxmem
    const mem = o.mem
    const maxcpu = o.maxcpu
    if (typeof mem === "number" && Number.isFinite(mem) && mem >= 0) memBytes = mem
    if (typeof maxmem === "number" && Number.isFinite(maxmem) && maxmem > 0) maxMemBytes = maxmem
    if (typeof maxcpu === "number" && Number.isFinite(maxcpu) && maxcpu > 0) maxCpu = maxcpu
    if (memBytes != null && maxMemBytes != null && maxMemBytes > 0) {
      memPct = Math.round(Math.min(1, Math.max(0, memBytes / maxMemBytes)) * 1000) / 10
    }

    out.set(name, { cpuPct: fractionToPct(o.cpu), memPct, memBytes, maxMemBytes, maxCpu })
  }
  return out
}

function roundTenth(n: number): number {
  return Math.round(n * 10) / 10
}

/** One cluster total. CPU is weighted by core count. Memory is the sum of used and installed RAM. */
export function consolidateNodeResources(nodes: readonly NodeResourceSample[]): ClusterResourceSample {
  let memBytes = 0
  let maxMemBytes = 0
  let memNodes = 0
  let cpuWeighted = 0
  let cores = 0
  let cpuSum = 0
  let cpuNodes = 0
  let cpuNodesWithCores = 0

  for (const node of nodes) {
    if (node.memBytes != null && node.maxMemBytes != null && node.maxMemBytes > 0) {
      memBytes += node.memBytes
      maxMemBytes += node.maxMemBytes
      memNodes += 1
    }
    if (node.cpuPct == null) continue
    cpuSum += node.cpuPct
    cpuNodes += 1
    if (node.maxCpu != null && node.maxCpu > 0) {
      cpuWeighted += (node.cpuPct / 100) * node.maxCpu
      cores += node.maxCpu
      cpuNodesWithCores += 1
    }
  }

  const cpuPct =
    cpuNodes > 0 && cpuNodesWithCores === cpuNodes && cores > 0
      ? roundTenth((cpuWeighted / cores) * 100)
      : cpuNodes > 0
        ? roundTenth(cpuSum / cpuNodes)
        : null
  const memPct = memNodes > 0 && maxMemBytes > 0 ? roundTenth((memBytes / maxMemBytes) * 100) : null

  return {
    cpuPct,
    memPct,
    memBytes: memNodes > 0 ? memBytes : null,
    maxMemBytes: memNodes > 0 ? maxMemBytes : null,
    nodeCount: nodes.length,
  }
}

export function parseNodeStatusLoad(raw: string): number | null {
  let inner: unknown
  try {
    inner = unwrapPveshJson(raw)
  } catch {
    return null
  }
  const o = inner && typeof inner === "object" ? (inner as Record<string, unknown>) : null
  if (!o) return null
  return parseLoad1(o.loadavg)
}
