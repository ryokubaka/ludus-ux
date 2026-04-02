/**
 * GET /api/range/ansible-inventory?rangeId=
 *
 * Server-side Ludus GET /range/ansibleinventory with the same API key resolution
 * as the proxy (session + admin impersonation cookie). Used by the dashboard so
 * inventory always uses the correct range id even if client context is briefly
 * out of sync with the expanded range card.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const rangeId = request.nextUrl.searchParams.get("rangeId")?.trim()
  if (!rangeId) {
    return NextResponse.json({ error: "rangeId is required" }, { status: 400 })
  }

  const impersonateApiKey =
    session.isAdmin
      ? (session.impersonationApiKey || request.headers.get("X-Impersonate-Apikey") || null)
      : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  const path = `/range/ansibleinventory?rangeID=${encodeURIComponent(rangeId)}`
  const result = await ludusRequest<unknown>(path, {
    apiKey: effectiveApiKey,
    timeout: 45_000,
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }

  return NextResponse.json(result.data ?? null, { status: result.status || 200 })
}
