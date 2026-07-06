import { NextRequest, NextResponse } from "next/server"
import { searchGalaxyCollections, searchGalaxyRoles } from "@/lib/ansible-galaxy-api"
import type { GalaxySearchHit } from "@/lib/ansible-galaxy-search"
import { resolveSession } from "@/lib/session"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIpFromRequest } from "@/lib/security-audit-log"

const GALAXY_RATE_MAX = Number(process.env.GALAXY_SEARCH_RATE_LIMIT_MAX ?? "30")
const GALAXY_RATE_WINDOW_MS = Number(
  process.env.GALAXY_SEARCH_RATE_LIMIT_WINDOW_MS ?? String(60 * 1000),
)

/** Proxy Ansible Galaxy search for LUX add dialogs (avoids browser CORS). */
export async function GET(request: NextRequest) {
  // Gate behind a session so this is not an open, unauthenticated upstream proxy.
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // Per-session (fallback IP) rate limit to prevent fan-out abuse of the Galaxy API.
  const rateKey = `galaxy:${session.username || clientIpFromRequest(request)}`
  const rate = checkRateLimit(rateKey, GALAXY_RATE_MAX, GALAXY_RATE_WINDOW_MS)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many searches, slow down." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 1) } },
    )
  }

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get("q") ?? "").trim()
  const type = searchParams.get("type") === "collection" ? "collection" : "role"

  if (q.length < 2) {
    return NextResponse.json({ items: [] as GalaxySearchHit[] })
  }

  try {
    const items =
      type === "collection" ? await searchGalaxyCollections(q) : await searchGalaxyRoles(q)
    return NextResponse.json({ items })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Galaxy search failed" },
      { status: 502 },
    )
  }
}
