import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { bustAdminCache } from "@/lib/admin-data"
import { ludusRequest, ludusRangeCreateApiKey } from "@/lib/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus-user-from-profile"
import { getSettings } from "@/lib/settings-store"
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
 * Resolves PocketBase Ludus userID via GET /user (same as [List user details](https://api-docs.ludus.cloud/list-user-details-24251971e0)),
 * forwards that to Ludus `/ranges/create` + assign — never trusts a login name as `userID`.
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

  const { apiKey: impersonateKey, userId: impersonateAs } = resolveAdminImpersonationFromRequest(session, request)
  const effectiveApiKey = impersonateKey || session.apiKey
  /** SSH / display hint when GET /user returns multiple rows (admin API key). */
  const hint = (impersonateAs || session.username).trim()

  const { rootApiKey } = getSettings()
  const createRangeApiKey = ludusRangeCreateApiKey(effectiveApiKey, rootApiKey)
  if (!createRangeApiKey) {
    return NextResponse.json(
      {
        error:
          "No Ludus API key for range creation — log in with your Ludus API key, or set ROOT in Settings / `LUDUS_ROOT_API_KEY` for headless use.",
      },
      { status: 500 },
    )
  }

  const who = await ludusRequest<unknown>("/user", { apiKey: effectiveApiKey })
  if (who.error || who.status !== 200) {
    return NextResponse.json(
      { error: who.error || `GET /user failed (HTTP ${who.status})` },
      { status: who.status > 0 ? who.status : 503 },
    )
  }

  const caller = ludusCallerFromGetUser(who.data, hint)
  if (!caller?.userId) {
    return NextResponse.json(
      {
        error:
          "Could not read your Ludus userID from GET /user — if you use an admin key, impersonate so LUX matches the right profile.",
      },
      { status: 422 },
    )
  }

  const pbId = caller.userId
  /** Always authoritative — client `userID` is ignored except optional extra alphanumeric ids merged below. */
  const userIDs = new Set<string>([pbId])
  const extra = Array.isArray(body.userID) ? body.userID : []
  for (const raw of extra) {
    if (typeof raw !== "string") continue
    const t = raw.trim()
    if (!t || t.toLowerCase() === pbId.toLowerCase()) continue
    if (/^[A-Za-z0-9]{1,20}$/.test(t)) userIDs.add(t)
  }

  try {
    const createRes = await ludusRequest<Record<string, unknown>>(`/ranges/create`, {
      method: "POST",
      apiKey: createRangeApiKey,
      useAdminEndpoint: true,
      body: { ...(body as CreateRangeBody), userID: [...userIDs] },
    })

    if (createRes.error) {
      return NextResponse.json(
        { error: createRes.error },
        { status: createRes.status > 0 ? createRes.status : 500 },
      )
    }

    const data = createRes.data

    const assignRes = await ludusRequest(
      `/ranges/assign/${encodeURIComponent(pbId)}/${encodeURIComponent(body.rangeID)}`,
      { method: "POST", apiKey: effectiveApiKey },
    )
    const alreadyOwned =
      typeof assignRes.error === "string" &&
      assignRes.error.toLowerCase().includes("already has access")

    if (!assignRes.error || alreadyOwned) {
      setOwnership(body.rangeID, pbId, session.username)
      bustAdminCache()
    }

    return NextResponse.json(data ?? {}, { status: createRes.status || 200 })
  } catch (err) {
    return NextResponse.json(
      { error: `Connection failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}
