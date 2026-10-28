import { NextRequest, NextResponse } from "next/server"
import { markRouteDynamic } from "@/lib/mark-route-dynamic"
import { requireSession } from "@/lib/require-session"
import { requireAdmin } from "@/lib/require-admin"
import { clearLuxReleasesCache, getLuxReleasesSnapshot } from "@/lib/lux-releases"
import { readLuxUpgradeLogTail } from "@/lib/lux-upgrade-host"

export async function GET(request: NextRequest) {
  await markRouteDynamic()
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  let includeUpgradeLog = false
  if (gate.session.isAdmin) {
    const admin = await requireAdmin(request)
    includeUpgradeLog = admin.ok
  }

  if (request.nextUrl.searchParams.get("refresh") === "1") clearLuxReleasesCache()
  const snapshot = await getLuxReleasesSnapshot()
  return NextResponse.json({
    ...snapshot,
    logTail: includeUpgradeLog ? readLuxUpgradeLogTail() : "",
  })
}
