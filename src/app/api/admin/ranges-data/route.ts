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
import { getAllOwnership, setOwnership, removeOwnership } from "@/lib/range-ownership-store"
import type { RangeObject, UserObject } from "@/lib/types"

export const dynamic = "force-dynamic"

// ── Server-side cache ────────────────────────────────────────────────────────
// Shared across all requests in the same Node.js process.  Resets on container
// restart but the SQLite ownership table survives.
interface CacheEntry {
  ranges: RangeObject[]
  users: UserObject[]
  ownership: Record<string, string>
  ts: number
}
let _cache: CacheEntry | null = null
const CACHE_TTL_MS = 30_000

// Not exported — internal helper only.  Next.js requires all route file exports
// to be HTTP handlers (GET, POST, etc.) or recognized constants.
function bustCache() {
  _cache = null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === "object" && "result" in data) {
    const r = (data as { result: unknown }).result
    if (Array.isArray(r)) return r as T[]
  }
  return []
}

async function buildAdminData(apiKey: string): Promise<CacheEntry> {
  // 1. Fetch ranges + users in parallel
  const [rangesRes, usersRes] = await Promise.all([
    ludusRequest<unknown>("/range/all", { apiKey }),
    ludusRequest<unknown>("/user/all", { apiKey }),
  ])

  let ranges: RangeObject[] = rangesRes.data ? extractArray<RangeObject>(rangesRes.data) : []
  const users: UserObject[] = usersRes.data ? extractArray<UserObject>(usersRes.data) : []

  // 2. Load persisted ownership from SQLite (highest-priority source)
  const storedOwnership = getAllOwnership() // Map<rangeID, userID>

  // 3. For ranges still lacking userID after Ludus response, try individual fetch
  //    (skip any range already covered by SQLite)
  const needsDetail = ranges
    .filter((r) => !r.userID && !storedOwnership.has(r.rangeID))
    .slice(0, 30) // cap to avoid overwhelming the Ludus server

  if (needsDetail.length > 0) {
    const details = await Promise.allSettled(
      needsDetail.map((r) =>
        ludusRequest<RangeObject & { ownerID?: string; owner?: string }>(
          `/range?rangeID=${encodeURIComponent(r.rangeID)}`,
          { apiKey },
        ),
      ),
    )
    for (let i = 0; i < needsDetail.length; i++) {
      const result = details[i]
      if (result.status === "fulfilled" && result.value.data) {
        const d = result.value.data
        const owner = d.userID || d.ownerID || d.owner
        if (owner) {
          const idx = ranges.findIndex((r) => r.rangeID === needsDetail[i].rangeID)
          if (idx !== -1) ranges[idx] = { ...ranges[idx], userID: owner }
        }
      }
    }
  }

  // 4. Build ownership map using priority heuristics
  const ownership: Record<string, string> = {}
  const claimed = new Set<string>()

  // Priority 1: SQLite overrides (always wins)
  for (const [rangeID, userID] of storedOwnership) {
    ownership[rangeID] = userID
    claimed.add(rangeID)
  }

  // Priority 2: range.userID from Ludus response
  for (const range of ranges) {
    if (claimed.has(range.rangeID)) continue
    const owner = range.userID ||
      (range as RangeObject & { ownerID?: string }).ownerID ||
      (range as RangeObject & { owner?: string }).owner
    if (owner) {
      ownership[range.rangeID] = owner
      claimed.add(range.rangeID)
    }
  }

  // Priority 3: range.rangeID === user.userID (primary range = username convention)
  const userIDs = new Set(users.map((u) => u.userID))
  for (const range of ranges) {
    if (claimed.has(range.rangeID)) continue
    if (userIDs.has(range.rangeID)) {
      ownership[range.rangeID] = range.rangeID
      claimed.add(range.rangeID)
    }
  }

  // Priority 4: user.defaultRangeID / user.rangeID
  for (const user of users) {
    const defRange = user.defaultRangeID || user.rangeID
    if (defRange && !claimed.has(defRange)) {
      ownership[defRange] = user.userID
      claimed.add(defRange)
    }
  }

  return { ranges, users, ownership, ts: Date.now() }
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  // Serve cache if fresh
  const now = Date.now()
  if (_cache && now - _cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(_cache)
  }

  try {
    const data = await buildAdminData(session.apiKey)
    _cache = data
    return NextResponse.json(data)
  } catch (err) {
    // If build fails but we have stale cache, return it with a warning header
    if (_cache) {
      return NextResponse.json(_cache, {
        headers: { "X-Cache-Stale": "true" },
      })
    }
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
  bustCache()

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
  bustCache()

  return NextResponse.json({ ok: true })
}
