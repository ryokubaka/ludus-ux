/**
 * POST /api/range/force-state
 *
 * Forces a Ludus range out of a stuck DEPLOYING/WAITING state when the
 * normal `range/abort` API fails (i.e. Ludus's internal goroutine has already
 * exited without updating PocketBase).
 *
 * Strategy (tried in order):
 *   1. Standard range/abort with the calling user's API key.
 *   2. Admin range/abort with the ROOT API key (elevated privileges — may
 *      succeed when the user-scoped call is rejected).
 *
 * Body: { rangeId: string, apiKey?: string }
 * The apiKey field is the effective (possibly impersonated) user key;
 * it must be supplied by the caller so this route doesn't need to re-derive it.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { getSettings } from "@/lib/settings-store"

export const dynamic = "force-dynamic"

async function tryAbort(rangeId: string, apiKey: string, useAdmin = false): Promise<boolean> {
  try {
    const result = await ludusRequest(
      `/range/abort?rangeID=${encodeURIComponent(rangeId)}`,
      { method: "POST", apiKey, useAdminEndpoint: useAdmin }
    )
    // 2xx → accepted; 204 → no content but success
    return result.status >= 200 && result.status < 300
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { rangeId?: string; apiKey?: string }
  try { body = await request.json() } catch { body = {} }

  const { rangeId, apiKey: bodyApiKey } = body
  if (!rangeId) {
    return NextResponse.json({ error: "rangeId required" }, { status: 400 })
  }

  // Resolve the effective API key (supports impersonation)
  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = bodyApiKey || impersonateApiKey || session.apiKey

  const settings = getSettings()

  // ── Strategy 1: user-scoped abort ─────────────────────────────────────────
  const ok1 = await tryAbort(rangeId, effectiveApiKey, false)
  if (ok1) {
    return NextResponse.json({ success: true, method: "user-abort" })
  }

  // ── Strategy 2: admin abort with root API key ──────────────────────────────
  // The admin endpoint (port 8081) may accept abort even when the deployment
  // goroutine has already exited, because it has direct PocketBase access.
  if (settings.rootApiKey) {
    const ok2 = await tryAbort(rangeId, settings.rootApiKey, true)
    if (ok2) {
      return NextResponse.json({ success: true, method: "admin-abort" })
    }
  }

  return NextResponse.json(
    {
      success: false,
      error: "Both user and admin abort attempts failed. " +
        "The Ludus server-side state is inconsistent. " +
        "Log in to the PocketBase admin console (port 8081, user root@ludus.internal, " +
        "password = root API key) and manually set the range's rangeState field to ERROR.",
    },
    { status: 502 }
  )
}
