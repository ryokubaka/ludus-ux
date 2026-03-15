/**
 * POST /api/admin/deploy-shared-service
 *
 * Dedicated endpoint for deploying the Nexus cache or Ludus File Share as a
 * one-time admin operation.  This route bypasses the generic /api/proxy so
 * that:
 *   1. The request ALWAYS uses the admin's own session API key — never an
 *      impersonated user's key that might be lurking in the proxy headers.
 *   2. The Ludus call is explicit and traceable in server logs.
 *   3. The exact URL + body sent to Ludus is returned in the response so
 *      the caller can verify what ran.
 *
 * Ludus API: POST /range/deploy  body: { "tags": ["nexus"|"share"] }
 * Optional query param: rangeID — if omitted Ludus uses the API key's
 * default range (which for an admin key is the admin's own range).
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  let body: { service?: string; rangeId?: string }
  try { body = await request.json() } catch { body = {} }

  const { service, rangeId } = body

  if (service !== "nexus" && service !== "share") {
    return NextResponse.json(
      { error: "service must be 'nexus' or 'share'" },
      { status: 400 },
    )
  }

  // Build the Ludus API path.  Include rangeID only when explicitly supplied
  // so the caller can override which range the VMs are created in.
  const ludusPath = rangeId
    ? `/range/deploy?rangeID=${encodeURIComponent(rangeId)}`
    : "/range/deploy"

  // Ludus expects tags as a comma-separated string — NOT a JSON array.
  // Sending an array causes Go JSON unmarshaling to silently ignore the field
  // and fall back to "all" (full deploy with no tag filter).
  const ludusBody = { tags: service }

  console.log(
    `[deploy-shared-service] Calling Ludus: POST ${ludusPath}`,
    `body=${JSON.stringify(ludusBody)}`,
    `user=${session.username}`,
  )

  const result = await ludusRequest(ludusPath, {
    method: "POST",
    body: ludusBody,
    apiKey: session.apiKey,   // admin's own key — never impersonated
  })

  console.log(
    `[deploy-shared-service] Ludus response: status=${result.status}`,
    result.error ? `error=${result.error}` : `data=${JSON.stringify(result.data)}`,
  )

  if (result.error) {
    return NextResponse.json(
      {
        error: result.error,
        debug: { ludusPath, ludusBody, adminUser: session.username },
      },
      { status: result.status || 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    service,
    debug: {
      ludusPath,
      ludusBody,
      adminUser: session.username,
      ludusResponse: result.data,
    },
  })
}
