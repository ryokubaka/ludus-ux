/**
 * POST /api/goad/instances/[instanceId]/init-range
 *
 * Ensures every GOAD instance has its own dedicated Ludus range so that
 * destroying the instance only removes its VMs — not the operator's other ranges.
 *
 * Flow:
 *  1. Check if .goad_range_id already exists in the workspace — idempotent.
 *  2. Derive a short rangeID from the instanceId (alphanumeric, ≤20 chars).
 *  3. Create the Ludus range via POST /api/v2/ranges/create on the **admin** API
 *     using GET /user (List user details) for the authoritative `userID`.
 *  4. Assign the range on the main Ludus API.
 *  5. Write the rangeID to <workspace>/<instanceId>/.goad_range_id.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { getSettings } from "@/lib/settings-store"
import { readGoadRangeId, writeGoadRangeId } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { ludusRequest, ludusRangeCreateApiKey } from "@/lib/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus-user-from-profile"
import { bustAdminCache } from "@/lib/admin-data"
import { setOwnership } from "@/lib/range-ownership-store"

export const dynamic = "force-dynamic"

function deriveRangeInfo(instanceId: string, username: string): { rangeId: string; name: string } {
  const user = username.toLowerCase().replace(/[^a-z0-9]/g, "")
  const instSlug = instanceId.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "")
  const rangeId = `${user}-${instSlug}`
  const name = rangeId
  return { rangeId, name }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = await params
  const settings = getSettings()

  const rootCreds = rootPasswordCredsIfSet(settings)

  const { apiKey: impersonateApiKey, userId: impersonateAs } = resolveAdminImpersonationFromRequest(session, request)
  const effectiveApiKey = impersonateApiKey || session.apiKey
  const effectiveUsername = impersonateAs || session.username
  const hint = effectiveUsername.trim()

  const existing = await readGoadRangeId(instanceId, rootCreds)
  if (existing) {
    const whoHeal = await ludusRequest<unknown>("/user", { apiKey: effectiveApiKey })
    const callerHeal =
      !whoHeal.error && whoHeal.status === 200
        ? ludusCallerFromGetUser(whoHeal.data, hint)
        : undefined
    const ownerPbId = callerHeal?.userId?.trim() || effectiveUsername
    setOwnership(existing, ownerPbId, session.username)
    bustAdminCache()
    return NextResponse.json({ rangeId: existing, created: false })
  }

  const { rangeId, name: rangeName } = deriveRangeInfo(instanceId, effectiveUsername)

  const createRangeApiKey = ludusRangeCreateApiKey(effectiveApiKey, settings.rootApiKey)
  if (!createRangeApiKey) {
    return NextResponse.json(
      {
        error: "No Ludus API key for range creation — log in, or set ROOT in Settings / `LUDUS_ROOT_API_KEY`.",
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
  const ludusUserId = caller?.userId?.trim()
  if (!ludusUserId) {
    return NextResponse.json(
      { error: "Could not resolve Ludus userID from GET /user for this GOAD range." },
      { status: 422 },
    )
  }

  const createRes = await ludusRequest<Record<string, unknown>>(`/ranges/create`, {
    method: "POST",
    apiKey: createRangeApiKey,
    useAdminEndpoint: true,
    body: {
      rangeID: rangeId,
      name: rangeName,
      description: `Dedicated range for GOAD instance ${instanceId}`,
      userID: [ludusUserId],
    },
  })

  const createOk =
    createRes.status === 409 ||
    (!createRes.error && (createRes.status === 200 || createRes.status === 201))
  const createError = createRes.error || (createOk ? "" : `HTTP ${createRes.status || 0}`)

  if (!createOk) {
    const errStatus =
      createRes.status === 401 || createRes.status === 403 ? createRes.status : 500
    return NextResponse.json(
      { error: `Failed to create Ludus range: ${createError || "unknown error"}` },
      { status: errStatus },
    )
  }

  const assignRes = await ludusRequest(
    `/ranges/assign/${encodeURIComponent(ludusUserId)}/${encodeURIComponent(rangeId)}`,
    { method: "POST", apiKey: effectiveApiKey },
  )
  const alreadyOwned =
    typeof assignRes.error === "string" && assignRes.error.toLowerCase().includes("already has access")
  if (!assignRes.error || alreadyOwned) {
    setOwnership(rangeId, ludusUserId, session.username)
    bustAdminCache()
  }

  try {
    await writeGoadRangeId(instanceId, rangeId, rootCreds)
  } catch (err) {
    return NextResponse.json(
      {
        error: `Created Ludus range ${rangeId} but failed to write it to workspace: ${(err as Error).message}`,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ rangeId, created: true })
}
