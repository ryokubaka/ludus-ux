/**
 * GET /api/range/log-enrichment?rangeId=
 * Returns LUX-persisted markers for Deploy History labels + Testing page.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { getSessionFromRequest } from "@/lib/session"
import { pruneLuxRangeLogMarkers, listLuxTestingEvents, listLuxDeployTagRuns } from "@/lib/range-log-markers-store"

function getEffective(
  request: NextRequest,
  session: {
    username: string
    isAdmin: boolean
    impersonationApiKey?: string
    impersonationUserId?: string
    impersonationLudusUserId?: string
    impersonationSshLogin?: string
  },
) {
  const imp = resolveAdminImpersonationFromRequest(session, request)
  return {
    effectiveUsername:
      imp.apiKey
        ? (imp.sshLogin || imp.ludusPrincipal || session.username).trim()
        : session.username,
  }
}

export async function GET(request: NextRequest) {
  try {
    pruneLuxRangeLogMarkers()
  } catch {}

  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const rangeId = request.nextUrl.searchParams.get("rangeId")
  if (!rangeId?.trim()) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const { effectiveUsername } = getEffective(request, session)

  const testingEvents = listLuxTestingEvents(rangeId.trim(), effectiveUsername, 120)
  const deployTagRuns = listLuxDeployTagRuns(rangeId.trim(), effectiveUsername, 200)

  return NextResponse.json({ testingEvents, deployTagRuns })
}
