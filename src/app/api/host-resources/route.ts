/**
 * GET /api/host-resources
 *
 * Ludus host CPU and memory from Proxmox cluster resources (one pvesh call).
 * Any signed-in session may read it. The dashboard polls this; snapshots are
 * served from a process-level cache and revalidated in the background so a
 * dashboard reload does not wait on SSH every time.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/session/require-session"
import {
  getHostResourcesWithMeta,
  hostResourcesLastError,
} from "@/lib/proxmox/host-resources-cache"
import { applyServerTiming } from "@/lib/lux/apply-server-timing"

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const requestStart = performance.now()
  const authStart = performance.now()
  const gate = await requireSession(req)
  const authMs = performance.now() - authStart
  if (!gate.ok) {
    return applyServerTiming(gate.response, {
      auth: authMs,
      total: performance.now() - requestStart,
    })
  }

  const result = await getHostResourcesWithMeta()
  if (!result.payload) {
    return applyServerTiming(
      NextResponse.json(
        { error: hostResourcesLastError() ?? "Host metrics unavailable" },
        { status: 503 },
      ),
      {
        auth: authMs,
        cache: { dur: 0, desc: result.cacheStatus },
        ssh: result.readMs,
        total: performance.now() - requestStart,
      },
    )
  }

  return applyServerTiming(NextResponse.json(result.payload), {
    auth: authMs,
    cache: { dur: 0, desc: result.cacheStatus },
    ssh: result.readMs,
    total: performance.now() - requestStart,
  })
}
