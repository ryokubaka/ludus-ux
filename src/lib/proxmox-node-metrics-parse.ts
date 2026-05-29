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

/** CPU/mem from pvestatd via cluster/resources — reliable unlike /nodes/{node}/status cpu. */
export function parseClusterResourceNodes(
  raw: string,
): Map<string, { cpuPct: number | null; memPct: number | null }> {
  const out = new Map<string, { cpuPct: number | null; memPct: number | null }>()
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
    const maxmem = o.maxmem
    const mem = o.mem
    if (typeof maxmem === "number" && maxmem > 0 && typeof mem === "number") {
      memPct = Math.round(Math.min(1, Math.max(0, mem / maxmem)) * 1000) / 10
    }

    out.set(name, { cpuPct: fractionToPct(o.cpu), memPct })
  }
  return out
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
