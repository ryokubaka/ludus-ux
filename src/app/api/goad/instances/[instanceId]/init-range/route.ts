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
 *  3. Create the Ludus range via POST /api/v2/ranges/create (admin port,
 *     authenticated with the caller's own API key so it belongs to them).
 *  4. Write the rangeID as a plain string to <workspace>/<instanceId>/.goad_range_id.
 *  5. Return { rangeId, created: true }.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { readGoadRangeId, writeGoadRangeId } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { ludusRequest } from "@/lib/ludus-client"
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

  const impersonateApiKey  = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const impersonateAs      = session.isAdmin
    ? request.headers.get("X-Impersonate-As") || null
    : null
  const effectiveApiKey    = impersonateApiKey  || session.apiKey
  const effectiveUsername  = (session.isAdmin && impersonateAs) ? impersonateAs : session.username

  // ── 1. Idempotency check ──────────────────────────────────────────────────
  const existing = await readGoadRangeId(instanceId, rootCreds)
  if (existing) {
    return NextResponse.json({ rangeId: existing, created: false })
  }

  // ── 2. Derive rangeID and display name ────────────────────────────────────
  // Naming: GOAD-<user>-<workspaceDirectoryName> (instanceId IS the workspace dir)
  const { rangeId, name: rangeName } = deriveRangeInfo(instanceId, effectiveUsername)

  // ── 3. Create the Ludus range (admin port, user's own API key) ─────────────
  const adminBase = (settings.ludusAdminUrl || settings.ludusUrl.replace(/:8080\b/, ":8081")).replace(/\/$/, "")
  const createUrl = `${adminBase}/api/v2/ranges/create`

  let createOk = false
  let createError = ""
  try {
    const res = await fetch(createUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": effectiveApiKey,
      },
      body: JSON.stringify({
        rangeID: rangeId,
        name: rangeName,
        description: `Dedicated range for GOAD instance ${instanceId}`,
        // Assign to the effective user so the range appears in their account immediately
        userID: [effectiveUsername],
      }),
      cache: "no-store",
    })
    // 200/201 = created; 409 = already exists (race or re-run)
    createOk = res.ok || res.status === 409
    if (!createOk) {
      const data = await res.json().catch(() => null)
      createError = data?.error || data?.result || `HTTP ${res.status}`
    }
  } catch (err) {
    createError = (err as Error).message
  }

  if (!createOk) {
    return NextResponse.json(
      { error: `Failed to create Ludus range: ${createError}` },
      { status: 500 }
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
