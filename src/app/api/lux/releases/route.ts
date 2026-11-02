import { NextRequest, NextResponse } from "next/server"
import { markRouteDynamic } from "@/lib/core/mark-route-dynamic"
import { requireSession } from "@/lib/session/require-session"
import { requireAdmin } from "@/lib/session/require-admin"
import { clearLuxReleasesCache, getLuxReleasesSnapshot } from "@/lib/lux/lux-releases"
import { readLuxUpgradeLogTail } from "@/lib/lux/lux-upgrade-host"

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
