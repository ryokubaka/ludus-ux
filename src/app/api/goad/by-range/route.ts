import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getInstanceIdForRange } from "@/lib/goad-instance-range-store"
import { fetchGoadInstancesForRequest } from "@/lib/fetch-goad-instances-for-request"

export const dynamic = "force-dynamic"

/**
 * GET /api/goad/by-range?rangeId=...
 * Returns the GOAD instance id (workspace folder) linked to this Ludus range, if any.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const rangeId = request.nextUrl.searchParams.get("rangeId")?.trim()
  if (!rangeId) {
    return NextResponse.json({ error: "rangeId query parameter required" }, { status: 400 })
  }

  const fromSqlite = getInstanceIdForRange(rangeId)
  if (fromSqlite) {
    return NextResponse.json({ instanceId: fromSqlite })
  }

  const result = await fetchGoadInstancesForRequest(request, session)
  if (!result.configured || result.error) {
    return NextResponse.json({ instanceId: null })
  }

  const match = result.instances.find((i) => i.ludusRangeId === rangeId)
  return NextResponse.json({ instanceId: match?.instanceId ?? null })
}
