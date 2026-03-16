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
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { setOwnership, removeOwnership } from "@/lib/range-ownership-store"
import { getAdminData, bustAdminCache } from "@/lib/admin-data"

export const dynamic = "force-dynamic"

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  try {
    const data = await getAdminData(session.apiKey)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Failed to fetch admin data" },
      { status: 500 },
    )
  }
}

// ── POST — assign a range to a user ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

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
    return NextResponse.json({ error: res.error }, { status: res.status || 500 })
  }

  // Save to SQLite — persists across restarts
  setOwnership(rangeID, userID, session.username)

  // Bust server cache so next GET reflects the new assignment
  bustAdminCache()

  return NextResponse.json({
    ok: true,
    confirmed: alreadyOwned,
    rangeID,
    userID,
  })
}

// ── DELETE — remove stored ownership (used when a range is deleted) ──────────

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  let body: { rangeID?: string }
  try { body = await request.json() } catch { body = {} }

  if (!body.rangeID) {
    return NextResponse.json({ error: "rangeID required" }, { status: 400 })
  }

  removeOwnership(body.rangeID)
  bustAdminCache()

  return NextResponse.json({ ok: true })
}
