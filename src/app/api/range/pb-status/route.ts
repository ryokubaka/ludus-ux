/**
 * /api/range/pb-status
 *
 * PocketBase-backed range status endpoint.  Queries PocketBase directly for
 * testingEnabled, rangeState, allowedDomains, etc. rather than going through
 * the Ludus REST API.  This avoids any caching layers in Ludus and gives a
 * near-instant, authoritative view of the range's persisted state.
 *
 * GET ?rangeId=xxx  → single RangeObject for that range
 * GET               → RangeObject[] for all ranges owned by the effective user
 *
 * Falls back to the Ludus API when PocketBase is unavailable (e.g. root API
 * key not configured).
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { fetchPbRangeStatus, fetchPbUserRanges } from "@/lib/pocketbase-client"
import { ludusRequest } from "@/lib/ludus-client"

export const dynamic = "force-dynamic"

function getEffectiveKeys(
  request: NextRequest,
  session: { apiKey: string; username: string; isAdmin: boolean; impersonationApiKey?: string; impersonationUserId?: string },
) {
  const impersonateApiKey = session.isAdmin
    ? (session.impersonationApiKey || request.headers.get("X-Impersonate-Apikey") || null)
    : null
  const impersonateUserId = session.isAdmin
    ? (session.impersonationUserId || request.headers.get("X-Impersonate-As") || null)
    : null
  return {
    effectiveApiKey:  impersonateApiKey || session.apiKey,
    effectiveUserId:  impersonateUserId || session.username,
  }
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const rangeId = request.nextUrl.searchParams.get("rangeId")
  const { effectiveApiKey, effectiveUserId } = getEffectiveKeys(request, session)

  // ── Single range ────────────────────────────────────────────────────────────
  if (rangeId) {
    // PocketBase fast-path: returns testingEnabled + rangeState without Ludus overhead
    const pbStatus = await fetchPbRangeStatus(rangeId)
    if (pbStatus) return NextResponse.json(pbStatus)

    // Fallback: query Ludus API (covers case where root API key is not configured)
    const result = await ludusRequest<unknown>(`/range?rangeID=${encodeURIComponent(rangeId)}`, {
      apiKey: effectiveApiKey,
    })
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 })
    }
    return NextResponse.json(result.data)
  }

  // ── All user ranges ─────────────────────────────────────────────────────────
  const pbRanges = await fetchPbUserRanges(effectiveUserId)
  if (pbRanges.length > 0) return NextResponse.json(pbRanges)

  // Fallback: query Ludus REST API for the user's range list
  const result = await ludusRequest<unknown>("/ranges", { apiKey: effectiveApiKey })
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }

  // Ludus wraps arrays in { result: [...] }
  const data = result.data
  const arr = Array.isArray(data)
    ? data
    : (data as { result?: unknown[] })?.result ?? []
  return NextResponse.json(arr)
}
