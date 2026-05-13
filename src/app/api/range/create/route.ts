import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { bustAdminCache } from "@/lib/admin-data"
import { ludusRequest } from "@/lib/ludus-client"
import { setOwnership } from "@/lib/range-ownership-store"

type CreateRangeBody = {
  rangeID: string
  name: string
  description?: string
  purpose?: string
  userID?: string[]
  [key: string]: unknown
}

export const dynamic = "force-dynamic"

/**
 * POST /api/range/create
 *
 * Creates a new Ludus range and assigns it to the requesting user.
 * Proxies to the Ludus admin API (port 8081) which handles the low-level
 * Proxmox pool + vmbr setup.
 *
 * The creating user is automatically added to the `userID` list so the range
 * appears in their account immediately — callers do not need to pass userID.
 * Admins impersonating another user will have the impersonated user assigned.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.rangeID || !body?.name) {
    return NextResponse.json({ error: "rangeID and name are required" }, { status: 400 })
  }

  // Determine the effective username — use impersonated username when an admin
  // is creating a range on behalf of another user.
  const impersonateAs   = request.headers.get("X-Impersonate-As") || null
  const impersonateKey  = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey  = impersonateKey  || session.apiKey
  const effectiveUsername = (session.isAdmin && impersonateAs) ? impersonateAs : session.username

  // Always assign the range to the effective user so it's visible in their
  // account immediately.  Merge with any userIDs the caller specified.
  const callerUserIds: string[] = Array.isArray(body.userID) ? body.userID : []
  const userID = Array.from(new Set([effectiveUsername, ...callerUserIds]))

  try {
    const createRes = await ludusRequest<Record<string, unknown>>(`/ranges/create`, {
      method: "POST",
      apiKey: effectiveApiKey,
      useAdminEndpoint: true,
      body: { ...(body as CreateRangeBody), userID },
    })

    if (createRes.error) {
      return NextResponse.json(
        { error: createRes.error },
        { status: createRes.status > 0 ? createRes.status : 500 },
      )
    }

    const data = createRes.data

    // ── Assign the range to the effective user ────────────────────────────────
    // Ludus ignores the `userID` field in the create body; assignment requires
    // a dedicated POST /ranges/assign/<user>/<rangeID> call on the standard port.
    const assignRes = await ludusRequest(
      `/ranges/assign/${encodeURIComponent(effectiveUsername)}/${encodeURIComponent(body.rangeID)}`,
      { method: "POST", apiKey: effectiveApiKey },
    )
    const alreadyOwned =
      typeof assignRes.error === "string" &&
      assignRes.error.toLowerCase().includes("already has access")

    if (!assignRes.error || alreadyOwned) {
      // Persist to SQLite so Ranges Overview reflects it immediately
      setOwnership(body.rangeID, effectiveUsername, session.username)
      bustAdminCache()
    }

    return NextResponse.json(data ?? {}, { status: createRes.status || 200 })
  } catch (err) {
    return NextResponse.json(
      { error: `Connection failed: ${(err as Error).message}` },
      { status: 500 }
    )
  }
}
