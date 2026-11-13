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
import { resolveAdminImpersonationFromRequest } from "@/lib/admin/admin-impersonation-request"
import { resolveSession } from "@/lib/session/session"
import {
  enrichRangesWithPbRecords,
  fetchPbRangeStatus,
  fetchPbRangeStatuses,
  fetchPbUserRanges,
} from "@/lib/core/pocketbase-client"
import type { RangeAccessEntry, RangeObject } from "@/lib/core/types"
import { extractArray } from "@/lib/core/utils"
import { ludusRequest } from "@/lib/ludus/ludus-client"


/** Normalize Ludus GET /range body (single object, array, or { result }). */
function ludusRangeListFromResponse(data: unknown): RangeObject[] {
  if (data == null) return []
  if (Array.isArray(data)) return data as RangeObject[]
  if (typeof data === "object" && data !== null && "result" in data) {
    const inner = (data as { result?: unknown }).result
    if (Array.isArray(inner)) return inner as RangeObject[]
    if (inner && typeof inner === "object") return [inner as RangeObject]
  }
  // Single range object
  if (typeof data === "object" && data !== null && "rangeID" in (data as object)) {
    return [data as RangeObject]
  }
  return []
}

async function getEffectiveKeys(
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
  const imp = await resolveAdminImpersonationFromRequest(session, request)
  const impersonateApiKey = imp.apiKey
  return {
    effectiveApiKey: impersonateApiKey || session.apiKey,
    /** PocketBase `ranges.userID` — Ludus alphanumeric id. */
    effectiveUserId:
      impersonateApiKey
        ? (imp.ludusUserId || imp.ludusPrincipal || session.username).trim()
        : session.username,
  }
}

/**
 * Range ids the effective API key may see, including group shares.
 * Null means the access check itself failed — callers must not fall back to
 * root-token PocketBase rows.
 */
async function accessibleRangeIds(apiKey: string): Promise<Set<string> | null> {
  const result = await ludusRequest<unknown>("/ranges/accessible", { apiKey })
  if (result.error || result.data == null) return null
  const ids = new Set<string>()
  for (const entry of extractArray<RangeAccessEntry>(result.data)) {
    const id = entry.rangeID?.trim()
    if (id) ids.add(id)
  }
  return ids
}

function rangeAccessDenied() {
  return NextResponse.json(
    { error: "Could not verify range access" },
    { status: 503, headers: { "X-LUX-Range-State-Source": "unknown" } },
  )
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const rangeId = request.nextUrl.searchParams.get("rangeId")
  const { effectiveApiKey, effectiveUserId } = await getEffectiveKeys(request, session)
  const allowedIds = await accessibleRangeIds(effectiveApiKey)
  if (!allowedIds) return rangeAccessDenied()

  // ── Bulk status for selector dots ───────────────────────────────────────────
  // One PB query for every visible range instead of one request per range.
  const rangeIdsParam = request.nextUrl.searchParams.get("rangeIds")
  if (rangeIdsParam !== null) {
    const ids = [...new Set(
      rangeIdsParam.split(",").map((id) => id.trim()).filter((id) => allowedIds.has(id)),
    )].slice(0, 200)
    if (ids.length === 0) {
      return NextResponse.json(
        { ranges: {}, sources: {} },
        { headers: { "X-LUX-Range-State-Source": "pocketbase" } },
      )
    }

    const pbById = await fetchPbRangeStatuses(ids)
    const missing = ids.filter((id) => !pbById[id])
    const ludusById = new Map<string, RangeObject>()
    if (missing.length > 0) {
      // Ludus `/range` covers the effective user's own ranges. Group-shared
      // ranges still come from PocketBase above.
      const result = await ludusRequest<unknown>("/range", { apiKey: effectiveApiKey })
      if (!result.error) {
        for (const range of ludusRangeListFromResponse(result.data)) {
          if (range.rangeID) ludusById.set(range.rangeID, range)
        }
      }
    }

    const ranges: Record<string, RangeObject | null> = {}
    const sources: Record<string, "pocketbase" | "ludus" | "unknown"> = {}
    for (const id of ids) {
      const pb = pbById[id]
      if (pb) {
        ranges[id] = pb
        sources[id] = "pocketbase"
        continue
      }
      const ludus = ludusById.get(id)
      if (ludus) {
        ranges[id] = ludus
        sources[id] = "ludus"
        continue
      }
      ranges[id] = null
      sources[id] = "unknown"
    }

    const sourceHeader = Object.values(sources).includes("pocketbase")
      ? "pocketbase"
      : Object.values(sources).includes("ludus")
        ? "ludus"
        : "unknown"
    return NextResponse.json(
      { ranges, sources },
      { headers: { "X-LUX-Range-State-Source": sourceHeader } },
    )
  }

  // ── Single range ────────────────────────────────────────────────────────────
  if (rangeId) {
    if (!allowedIds.has(rangeId)) {
      return NextResponse.json(
        { error: "Range not found" },
        { status: 404, headers: { "X-LUX-Range-State-Source": "unknown" } },
      )
    }
    const pbStatus = await fetchPbRangeStatus(rangeId)
    if (pbStatus) {
      return NextResponse.json(pbStatus, {
        headers: { "X-LUX-Range-State-Source": "pocketbase" },
      })
    }

    // Fallback: query Ludus API (covers case where root API key is not configured)
    const result = await ludusRequest<unknown>(`/range?rangeID=${encodeURIComponent(rangeId)}`, {
      apiKey: effectiveApiKey,
    })
    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status || 500, headers: { "X-LUX-Range-State-Source": "ludus" } },
      )
    }
    return NextResponse.json(result.data, {
      headers: { "X-LUX-Range-State-Source": "ludus" },
    })
  }

  // ── All user ranges ─────────────────────────────────────────────────────────
  const pbRanges = (await fetchPbUserRanges(effectiveUserId)).filter(
    (range) => range.rangeID && allowedIds.has(range.rangeID),
  )
  if (pbRanges.length > 0) {
    return NextResponse.json(pbRanges, {
      headers: { "X-LUX-Range-State-Source": "pocketbase" },
    })
  }

  // PB list-by-user failed (400 on sort/filter, wrong schema, etc.) or returned no rows.
  // Ludus v2: GET /range returns this user's ranges. Merge each row with PocketBase
  // by rangeID so testingEnabled / rangeState still come from PB (source of truth).
  const result = await ludusRequest<unknown>("/range", { apiKey: effectiveApiKey })
  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status || 500, headers: { "X-LUX-Range-State-Source": "ludus" } },
    )
  }

  const ludusRanges = ludusRangeListFromResponse(result.data)
  const enriched = await enrichRangesWithPbRecords(ludusRanges)
  return NextResponse.json(enriched, {
    headers: { "X-LUX-Range-State-Source": "ludus" },
  })
}
