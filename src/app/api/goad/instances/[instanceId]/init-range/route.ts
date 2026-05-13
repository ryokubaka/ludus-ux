/**
 * POST /api/goad/instances/[instanceId]/init-range
 *
 * Ensures every GOAD instance has its own dedicated Ludus range so that
 * destroying the instance only removes its VMs — not the operator's other ranges.
 *
 * Ludus v2 supports 1-to-many user→range relationships via pocketbase.
 * We simply create a new range scoped to the current user for each GOAD instance.
 *
 * Flow:
 *  1. Check if .goad_range_id already exists in the workspace — idempotent.
 *  2. Derive a short rangeID from the instanceId (alphanumeric, ≤20 chars).
 *  3. Create the Ludus range via POST /api/v2/ranges/create on the **admin** API
 *     using the session (or impersonation) Ludus API key, same as `/api/range/create`;
 *     optional ROOT key in settings is a fallback only.
 *  4. Assign the range to the user on the main Ludus API (session / impersonation key).
 *  5. Write the rangeID as a plain string to <workspace>/<instanceId>/.goad_range_id.
 *  6. Return { rangeId, created: true }.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { getSettings } from "@/lib/settings-store"
import { readGoadRangeId, writeGoadRangeId } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { ludusRequest, ludusRangeCreateApiKey } from "@/lib/ludus-client"
import { bustAdminCache } from "@/lib/admin-data"
import { setOwnership } from "@/lib/range-ownership-store"

export const dynamic = "force-dynamic"

/** Derive a Ludus rangeID and display name from a GOAD instanceId + username.
 *  Format: <user>-<instanceSlug>  e.g. "melchior-GOAD-Mini-LDQ8" */
function deriveRangeInfo(instanceId: string, username: string): { rangeId: string; name: string } {
  const user     = username.toLowerCase().replace(/[^a-z0-9]/g, "")
  const instSlug = instanceId.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "")
  const rangeId  = `${user}-${instSlug}`
  const name     = rangeId
  return { rangeId, name }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = await params
  const settings = getSettings()

  const rootCreds = rootPasswordCredsIfSet(settings)

  const { apiKey: impersonateApiKey, userId: impersonateAs } = resolveAdminImpersonationFromRequest(session, request)
  const effectiveApiKey   = impersonateApiKey || session.apiKey
  const effectiveUsername = impersonateAs || session.username

  // ── 1. Idempotency check ──────────────────────────────────────────────────
  const existing = await readGoadRangeId(instanceId, rootCreds)
  if (existing) {
    // Heal SQLite + bust admin cache — older flows wrote .goad_range_id without
    // persisting ownership; Ranges Overview merges SQLite first.
    setOwnership(existing, effectiveUsername, session.username)
    bustAdminCache()
    return NextResponse.json({ rangeId: existing, created: false })
  }

  // ── 2. Derive rangeID and display name ────────────────────────────────────
  // Naming: GOAD-<user>-<workspaceDirectoryName> (instanceId IS the workspace dir)
  const { rangeId, name: rangeName } = deriveRangeInfo(instanceId, effectiveUsername)

  // ── 3. Create the Ludus range (admin API; key = session Ludus API key, ROOT fallback) ─
  const createRangeApiKey = ludusRangeCreateApiKey(effectiveApiKey, settings.rootApiKey)
  if (!createRangeApiKey) {
    return NextResponse.json(
      {
        error: "No Ludus API key for range creation — log in, or set ROOT in Settings / `LUDUS_ROOT_API_KEY`.",
      },
      { status: 500 },
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
      userID: [effectiveUsername],
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

  // ── 4. Assign the range to the user ──────────────────────────────────────
  // Ludus create body ignores userID; assignment requires a separate call.
  const assignRes = await ludusRequest(
    `/ranges/assign/${encodeURIComponent(effectiveUsername)}/${encodeURIComponent(rangeId)}`,
    { method: "POST", apiKey: effectiveApiKey },
  )
  const alreadyOwned =
    typeof assignRes.error === "string" &&
    assignRes.error.toLowerCase().includes("already has access")
  if (!assignRes.error || alreadyOwned) {
    setOwnership(rangeId, effectiveUsername, session.username)
    bustAdminCache()
  }

  // ── 5. Write rangeID to workspace ─────────────────────────────────────────
  try {
    await writeGoadRangeId(instanceId, rangeId, rootCreds)
  } catch (err) {
    return NextResponse.json(
      { error: `Created Ludus range ${rangeId} but failed to write it to workspace: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ rangeId, created: true })
}
