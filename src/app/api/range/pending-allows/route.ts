/**
 * /api/range/pending-allows
 *
 * DB-backed tracking of pending domain/IP allow & deny operations.
 * State persists across logouts, browser switches, and container restarts.
 *
 * GET    ?rangeId=xxx
 *   Returns { adds: string[], removes: string[] } from the DB.
 *   Prunes stale entries (>1 hr) and auto-confirms entries older than 5 min
 *   as a safety net for the Ludus PocketBase sync bug.
 *   Primary reconciliation happens CLIENT-SIDE after the UI fetches both
 *   the live allowedDomains list and the pending state.
 *
 * POST   { rangeId, entry, opType }  → 201
 * DELETE { rangeId, entries, opType } → 200  (reconciliation cleanup)
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import {
  getPendingAllowsWithTimestamps,
  addPendingAllow,
  removePendingAllows,
  pruneStalePendingAllows,
  type PendingAllowOpType,
} from "@/lib/pending-allow-store"

const PENDING_ADD_TIMEOUT_MS = 5 * 60 * 1000

function getEffective(
  request: NextRequest,
  session: { apiKey: string; username: string; isAdmin: boolean },
) {
  const impersonateAs = session.isAdmin
    ? request.headers.get("X-Impersonate-As") || null
    : null
  return {
    effectiveUsername: impersonateAs || session.username,
  }
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try { pruneStalePendingAllows() } catch {}

  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const rangeId = request.nextUrl.searchParams.get("rangeId")
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const { effectiveUsername } = getEffective(request, session)
  const pendingTs = getPendingAllowsWithTimestamps(rangeId, effectiveUsername)

  if (pendingTs.adds.length === 0 && pendingTs.removes.length === 0) {
    return NextResponse.json({ adds: [], removes: [] })
  }

  let adds    = pendingTs.adds.map(e => e.entry)
  let removes = pendingTs.removes.map(e => e.entry)

  // Time-based auto-confirmation safety net: Ludus applies iptables rules
  // immediately but sometimes never writes the domain back to PocketBase.
  // If a pending entry has been waiting longer than 5 min, treat it as done.
  const now = Date.now()
  const timedOutAdds = pendingTs.adds
    .filter(e => (now - e.createdAt) >= PENDING_ADD_TIMEOUT_MS)
    .map(e => e.entry)
  if (timedOutAdds.length > 0) {
    removePendingAllows(rangeId, effectiveUsername, timedOutAdds, "add")
    adds = adds.filter(a => !timedOutAdds.includes(a))
    console.log(`[pending-allows] auto-confirmed stale adds for ${effectiveUsername}/${rangeId}: ${timedOutAdds.join(", ")}`)
  }

  const timedOutRemoves = pendingTs.removes
    .filter(e => (now - e.createdAt) >= PENDING_ADD_TIMEOUT_MS)
    .map(e => e.entry)
  if (timedOutRemoves.length > 0) {
    removePendingAllows(rangeId, effectiveUsername, timedOutRemoves, "remove")
    removes = removes.filter(r => !timedOutRemoves.includes(r))
    console.log(`[pending-allows] auto-confirmed stale removes for ${effectiveUsername}/${rangeId}: ${timedOutRemoves.join(", ")}`)
  }

  return NextResponse.json({ adds, removes })
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: { rangeId?: string; entry?: string; opType?: string }
  try { body = await request.json() } catch { body = {} }

  const { rangeId, entry, opType } = body
  if (!rangeId || !entry) {
    return NextResponse.json({ error: "rangeId and entry required" }, { status: 400 })
  }
  if (opType !== "add" && opType !== "remove") {
    return NextResponse.json({ error: "opType must be 'add' or 'remove'" }, { status: 400 })
  }

  const { effectiveUsername } = getEffective(request, session)
  addPendingAllow(rangeId, effectiveUsername, entry, opType as PendingAllowOpType)
  console.log(`[pending-allows] POST ${effectiveUsername}/${rangeId}: ${opType} "${entry}"`)
  return NextResponse.json({ ok: true }, { status: 201 })
}

// ── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: { rangeId?: string; entries?: string[]; opType?: string }
  try { body = await request.json() } catch { body = {} }

  const { rangeId, entries, opType } = body
  if (!rangeId || !entries || !Array.isArray(entries)) {
    return NextResponse.json({ error: "rangeId and entries[] required" }, { status: 400 })
  }
  if (opType !== "add" && opType !== "remove") {
    return NextResponse.json({ error: "opType must be 'add' or 'remove'" }, { status: 400 })
  }

  const { effectiveUsername } = getEffective(request, session)
  removePendingAllows(rangeId, effectiveUsername, entries, opType as PendingAllowOpType)
  console.log(`[pending-allows] DELETE ${effectiveUsername}/${rangeId}: ${opType} [${entries.join(", ")}]`)
  return NextResponse.json({ ok: true })
}
