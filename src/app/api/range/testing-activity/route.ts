/**
 * POST /api/range/testing-activity
 * Body: { rangeId, opType: "testing_allow_add" | "testing_allow_remove", detail, success }
 * Appends a row to lux_range_testing_events for the Testing page activity list.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { getSessionFromRequest } from "@/lib/session"
import { insertLuxTestingEvent, pruneLuxRangeLogMarkers } from "@/lib/range-log-markers-store"
import type { LuxTestingOpType } from "@/lib/range-log-marker-types"

const DETAIL_MAX = 500

function isAllowlistTestingOpType(s: string): s is "testing_allow_add" | "testing_allow_remove" {
  return s === "testing_allow_add" || s === "testing_allow_remove"
}

function getEffective(
  request: NextRequest,
  session: {
    apiKey: string
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

export async function POST(request: NextRequest) {
  try {
    pruneLuxRangeLogMarkers()
  } catch {}

  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: { rangeId?: unknown; opType?: unknown; detail?: unknown; success?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rangeId = typeof body.rangeId === "string" ? body.rangeId.trim() : ""
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const opTypeRaw = typeof body.opType === "string" ? body.opType.trim() : ""
  if (!isAllowlistTestingOpType(opTypeRaw)) {
    return NextResponse.json({ error: "opType must be testing_allow_add or testing_allow_remove" }, { status: 400 })
  }
  const opType: LuxTestingOpType = opTypeRaw

  let detail: string | null =
    typeof body.detail === "string" ? body.detail.trim().slice(0, DETAIL_MAX) : null
  if (!detail) detail = null

  const success = body.success === true

  const { effectiveUsername } = getEffective(request, session)
  const now = Date.now()

  const id = insertLuxTestingEvent({
    rangeId,
    username: effectiveUsername,
    opType,
    rangeOpId: null,
    requestedAt: now,
    completedAt: now,
    success,
    ludusLogId: null,
    detail,
  })

  return NextResponse.json({ id })
}
