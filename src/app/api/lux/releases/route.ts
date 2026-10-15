import { NextRequest, NextResponse } from "next/server"
import { markRouteDynamic } from "@/lib/mark-route-dynamic"
import { getSessionFromRequest } from "@/lib/session"
import { clearLuxReleasesCache, getLuxReleasesSnapshot } from "@/lib/lux-releases"
import { readLuxUpgradeLogTail } from "@/lib/lux-upgrade-host"

export async function GET(request: NextRequest) {
  await markRouteDynamic()
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get("refresh") === "1") clearLuxReleasesCache()
  const snapshot = await getLuxReleasesSnapshot()
  return NextResponse.json({
    ...snapshot,
    logTail: session.isAdmin ? readLuxUpgradeLogTail() : "",
  })
}
