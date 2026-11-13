/**
 * /api/admin/ranges-data
 *
 * Single aggregated admin endpoint that replaces the N separate Ludus API
 * calls previously made by the client-side admin page.  The heavy work
 * (fetching all ranges, all users, and individual range details for ownership
 * resolution) happens here on the server with a 30-second in-process cache
 * shared across all browser tabs/requests.
 *
 * Ownership resolution priority (highest → lowest):
 *   1. SQLite range_ownership table  (admin-confirmed, survives restarts)
 *   2. range.userID field from GET /range/all
 *   3. range.rangeID === user.userID  (Ludus primary-range convention)
 *   4. user.defaultRangeID / user.rangeID
 *   5. Individual GET /range?rangeID=X  (may surface userID bulk endpoint omits)
 *
 * GET  → { ranges, users, ownership: { [rangeID]: userID } }
 * POST { rangeID, userID } → assign; saves to Ludus + SQLite; busts cache
 * DELETE { rangeID } → remove ownership from SQLite only; busts cache
 */

import { NextRequest, NextResponse } from "next/server"
import { logAndSafeError } from "@/lib/ui/safe-client-error"
import { finishAdminResponse, requireAdmin } from "@/lib/session/require-admin"
import { ludusRequest } from "@/lib/ludus/ludus-client"
import { setOwnership, removeOwnership } from "@/lib/range/range-ownership-store"
import { getAdminData, bustAdminCache } from "@/lib/admin/admin-data"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"
import { applyServerTiming } from "@/lib/lux/apply-server-timing"


// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const requestStart = performance.now()
  const authStart = performance.now()
  const admin = await requireAdmin(request)
  const authMs = performance.now() - authStart
  if (!admin.ok) {
    return applyServerTiming(admin.response, {
      auth: authMs,
      total: performance.now() - requestStart,
    })
  }

  // Explicit refresh bypasses the 30 s server cache so the admin page can
  // retry a partial ownership resolution instead of receiving the same body.
  const force = request.nextUrl.searchParams.get("refresh") === "1"
  const dataStart = performance.now()
  try {
    const data = await getAdminData(
      admin.session.apiKey,
      force ? { bypassCache: true } : undefined,
    )
    const response = await finishAdminResponse(NextResponse.json(data), admin)
    return applyServerTiming(response, {
      auth: authMs,
      data: performance.now() - dataStart,
      total: performance.now() - requestStart,
    })
  } catch (err) {
    const response = await finishAdminResponse(
      NextResponse.json(
        { error: (err as Error).message || "Failed to fetch admin data" },
        { status: 500 },
      ),
      admin,
    )
    return applyServerTiming(response, {
      auth: authMs,
      data: performance.now() - dataStart,
      total: performance.now() - requestStart,
    })
  }
}

// ── POST — assign a range to a user ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const { session } = admin

  let body: { rangeID?: string; userID?: string }
  try { body = await request.json() } catch { body = {} }

  const { rangeID, userID } = body
  if (!rangeID || !userID) {
    return NextResponse.json({ error: "rangeID and userID required" }, { status: 400 })
  }

  // Call Ludus assign API
  const res = await ludusRequest(
    `/ranges/assign/${encodeURIComponent(userID)}/${encodeURIComponent(rangeID)}`,
    { method: "POST", apiKey: session.apiKey },
  )

  const alreadyOwned = typeof res.error === "string" &&
    res.error.toLowerCase().includes("already has access")

  if (res.error && !alreadyOwned) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: res.error })
    return NextResponse.json({ error: res.error }, { status: res.status || 500 })
  }

  // Save to SQLite — persists across restarts
  setOwnership(rangeID, userID, session.username)

  // Bust server cache so next GET reflects the new assignment
  bustAdminCache()

  logLuxRouteAction(request, session, { detail: `rangeID=${rangeID} userID=${userID}` })
  return finishAdminResponse(
    NextResponse.json({
      ok: true,
      confirmed: alreadyOwned,
      rangeID,
      userID,
    }),
    admin,
  )
}

// ── DELETE — remove stored ownership (used when a range is deleted) ──────────

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const { session } = admin

  let body: { rangeID?: string }
  try { body = await request.json() } catch { body = {} }

  if (!body.rangeID) {
    return NextResponse.json({ error: "rangeID required" }, { status: 400 })
  }

  removeOwnership(body.rangeID)
  bustAdminCache()

  logLuxRouteAction(request, session, { detail: `rangeID=${body.rangeID}` })
  return finishAdminResponse(NextResponse.json({ ok: true }), admin)
}
