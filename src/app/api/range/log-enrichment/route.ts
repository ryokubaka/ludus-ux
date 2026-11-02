/**
 * GET /api/range/log-enrichment?rangeId=
 * Returns LUX-persisted markers for Deploy History labels + Testing page.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin/admin-impersonation-request"
import { requireSession } from "@/lib/session/require-session"
import { pruneLuxRangeLogMarkers, listLuxTestingEvents, listLuxDeployTagRuns } from "@/lib/logs/range-log-markers-store"

async function getEffective(
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
  const imp = await resolveAdminImpersonationFromRequest(session, request)
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
  } catch (err) {
    console.warn("[log-enrichment] pruneLuxRangeLogMarkers:", (err as Error).message)
  }

  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const session = gate.session

  const rangeId = request.nextUrl.searchParams.get("rangeId")
  if (!rangeId?.trim()) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const { effectiveUsername } = await getEffective(request, session)

  const testingEvents = listLuxTestingEvents(rangeId.trim(), effectiveUsername, 120)
  const deployTagRuns = listLuxDeployTagRuns(rangeId.trim(), effectiveUsername, 200)

  return NextResponse.json({ testingEvents, deployTagRuns })
}
