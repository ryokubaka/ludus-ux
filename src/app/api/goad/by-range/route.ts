import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session/session"
import { getInstanceIdForRange } from "@/lib/goad/goad-instance-range-store"
import { fetchGoadInstancesForRequest } from "@/lib/goad/fetch-goad-instances-for-request"
import { applyServerTiming } from "@/lib/lux/apply-server-timing"


/**
 * GET /api/goad/by-range?rangeId=...
 * Returns the GOAD instance id (workspace folder) linked to this Ludus range, if any.
 */
export async function GET(request: NextRequest) {
  const requestStart = performance.now()
  const authStart = performance.now()
  const session = await resolveSession(request)
  const authMs = performance.now() - authStart
  if (!session) {
    return applyServerTiming(NextResponse.json({ error: "Not authenticated" }, { status: 401 }), {
      auth: authMs,
      total: performance.now() - requestStart,
    })
  }

  const rangeId = request.nextUrl.searchParams.get("rangeId")?.trim()
  if (!rangeId) {
    return applyServerTiming(
      NextResponse.json({ error: "rangeId query parameter required" }, { status: 400 }),
      {
        auth: authMs,
        total: performance.now() - requestStart,
      },
    )
  }

  const fromSqlite = getInstanceIdForRange(rangeId)
  if (fromSqlite) {
    return applyServerTiming(NextResponse.json({ instanceId: fromSqlite }), {
      auth: authMs,
      cache: { dur: 0, desc: "sqlite" },
      total: performance.now() - requestStart,
    })
  }

  const result = await fetchGoadInstancesForRequest(request, session)
  const timing = {
    auth: authMs,
    ...(result.configured && result.timings
      ? { ssh: result.timings.sshMs, upstream: result.timings.upstreamMs }
      : {}),
    total: performance.now() - requestStart,
  }

  if (!result.configured) {
    return applyServerTiming(NextResponse.json({ instanceId: null }), timing)
  }
  if (result.error) {
    return applyServerTiming(
      NextResponse.json({ error: result.error, instanceId: null }, { status: 503 }),
      timing,
    )
  }

  const match = result.instances.find((i) => i.ludusRangeId === rangeId)
  return applyServerTiming(
    NextResponse.json({ instanceId: match?.instanceId ?? null }),
    timing,
  )
}
