import { NextRequest, NextResponse } from "next/server"
import { markRouteDynamic } from "@/lib/mark-route-dynamic"
import { resolveSession } from "@/lib/session"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import {
  applySelectedRangeCookie,
  clearSelectedRangeCookie,
  isValidSelectedRangeId,
} from "@/lib/selected-range-cookie"

type Body = { rangeId?: string | null }

/**
 * POST /api/session/selected-range
 * Mirror client range selection to httpOnly cookie for SSR prefetch.
 * Pass `rangeId: null` to clear.
 */
export async function POST(request: NextRequest) {
  await markRouteDynamic()
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: Body = {}
  try {
    body = (await request.json()) as Body
  } catch {
    body = {}
  }

  const response = NextResponse.json({ ok: true })
  const scopeTag = effectiveScopeTagFromSession(session)
  const rangeId = body.rangeId

  if (rangeId == null || rangeId === "") {
    clearSelectedRangeCookie(response)
    return response
  }

  const trimmed = String(rangeId).trim()
  if (!isValidSelectedRangeId(trimmed)) {
    return NextResponse.json({ error: "Invalid rangeId" }, { status: 400 })
  }

  applySelectedRangeCookie(response, scopeTag, trimmed)
  return response
}
