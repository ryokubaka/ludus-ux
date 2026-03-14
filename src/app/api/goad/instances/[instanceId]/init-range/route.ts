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
import { readGoadRangeId, writeGoadRangeId, type SSHCreds } from "@/lib/goad-ssh"

export const dynamic = "force-dynamic"

/** Derive a safe Ludus rangeID from a GOAD instanceId.
 *  Keep it alphanumeric and ≤20 chars (Ludus constraint). */
function deriveRangeId(instanceId: string): string {
  const sanitized = instanceId.replace(/[^a-zA-Z0-9]/g, "")
  // Prefix "G" ensures it never starts with a digit
  return ("G" + sanitized).substring(0, 20)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { instanceId: string } }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = params
  const settings = getSettings()

  const rootCreds: SSHCreds | undefined = settings.proxmoxSshPassword
    ? { username: settings.proxmoxSshUser || "root", password: settings.proxmoxSshPassword }
    : undefined

  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  // ── 1. Idempotency check ──────────────────────────────────────────────────
  const existing = await readGoadRangeId(instanceId, rootCreds)
  if (existing) {
    return NextResponse.json({ rangeId: existing, created: false })
  }

  // ── 2. Derive rangeID ─────────────────────────────────────────────────────
  const rangeId = deriveRangeId(instanceId)

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
        name: `GOAD ${instanceId}`,
        description: `Dedicated range for GOAD instance ${instanceId}`,
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

  // ── 4. Write rangeID to workspace ─────────────────────────────────────────
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
