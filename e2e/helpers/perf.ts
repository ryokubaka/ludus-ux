import type { Request, Response } from "@playwright/test"

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]
}

/** Parse a `Server-Timing` header into phase durations (milliseconds). */
export function parseServerTiming(value: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of value.split(",")) {
    const [rawName, ...params] = part.trim().split(";")
    const name = rawName.trim()
    if (!name) continue
    const durParam = params.find((p) => p.trim().startsWith("dur="))
    if (!durParam) continue
    const dur = Number(durParam.trim().slice(4))
    if (Number.isFinite(dur)) out[name] = dur
  }
  return out
}

function apiPath(url: string): string | null {
  try {
    const path = new URL(url).pathname
    return path.startsWith("/api/") ? path : null
  } catch {
    return null
  }
}

export interface ApiPathMetrics {
  count: number
  statuses: Record<string, number>
  p50Ms: number
  p95Ms: number
  serverTiming?: Record<string, number>
}

export interface ApiTallySnapshot {
  apiRequests: Record<string, ApiPathMetrics>
  postLoadApiRequests: number
}

/**
 * Counts API requests and responses for one page load. `markLoaded` starts the
 * post-load window so poll cadence can be compared with the initial load.
 */
export function createApiTally() {
  const starts = new WeakMap<Request, number>()
  const samples = new Map<string, number[]>()
  const statuses = new Map<string, Record<string, number>>()
  const serverTiming = new Map<string, Record<string, number>>()
  let postLoadApiRequests = 0
  let loaded = false

  function onRequest(req: Request) {
    const path = apiPath(req.url())
    if (!path) return
    starts.set(req, Date.now())
    if (loaded) postLoadApiRequests += 1
  }

  function onResponse(res: Response) {
    const path = apiPath(res.url())
    if (!path) return
    const start = starts.get(res.request())
    const ms = start ? Math.max(0, Date.now() - start) : 0
    const list = samples.get(path) ?? []
    list.push(ms)
    samples.set(path, list)

    const status = String(res.status())
    const byStatus = statuses.get(path) ?? {}
    byStatus[status] = (byStatus[status] ?? 0) + 1
    statuses.set(path, byStatus)

    const timing = res.headers()["server-timing"]
    if (timing) serverTiming.set(path, parseServerTiming(timing))
  }

  return {
    onRequest,
    onResponse,
    markLoaded: () => {
      loaded = true
    },
    snapshot: (): ApiTallySnapshot => {
      const apiRequests: Record<string, ApiPathMetrics> = {}
      for (const [path, values] of samples) {
        apiRequests[path] = {
          count: values.length,
          statuses: { ...(statuses.get(path) ?? {}) },
          p50Ms: percentile(values, 0.5),
          p95Ms: percentile(values, 0.95),
          ...(serverTiming.has(path) ? { serverTiming: serverTiming.get(path) } : {}),
        }
      }
      return { apiRequests, postLoadApiRequests }
    },
  }
}
