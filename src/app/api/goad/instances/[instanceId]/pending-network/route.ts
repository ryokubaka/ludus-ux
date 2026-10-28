/**
 * Temporary server-side store for wizard-provided network rules.
 *
 * When a user creates a new GOAD instance via the wizard and provides custom
 * firewall rules, GOAD's internal install process overwrites range-config.yml
 * before those rules can be applied. The wizard persists the network snapshot
 * here; after the GOAD SSH task completes, `goad-pending-network-workflow.ts`
 * consumes it server-side (no need to keep the instance page open). GET reads
 * without consuming; the POST take branch remains for the instance page.
 *
 * Storage: DATA_DIR/pending-network/{instanceId}.json
 * Follows the same pattern as DATA_DIR/tasks/ (metadata in files, not in DB).
 *
 * Clients that need to read+delete the snapshot should POST the same URL with
 * body `{ "__luxConsumePendingNetwork": true }` (see POST handler branch).
 */
import fs from "fs"
import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/require-session"
import { effectiveImpersonatedOperatorUsername } from "@/lib/admin-impersonation-request"
import { liveSessionIsAdmin } from "@/lib/session-admin-check"
import { assertGoadInstanceAccess } from "@/lib/goad-instance-access"
import {
  InvalidInstanceIdError,
  assertSafeInstanceId,
  canAccessPendingNetwork,
  pendingNetworkJsonPath,
  readPendingNetworkEnvelope,
  readUnlinkPendingNetworkSnapshot,
  writePendingNetworkSnapshot,
} from "@/lib/goad-pending-network-fs"
import type { ResolvedSession } from "@/lib/session"
import { logLuxRouteAction } from "@/lib/lux-api-audit"


const LUX_CONSUME_PENDING_BODY_KEY = "__luxConsumePendingNetwork"

function invalidInstanceResponse(): NextResponse {
  return NextResponse.json({ error: "Invalid instance id" }, { status: 400 })
}

/** The snapshot's owner may read or drop it. Anyone else needs access to the instance. */
async function snapshotReadAllows(
  session: ResolvedSession,
  request: NextRequest,
  instanceId: string,
): Promise<NextResponse | null> {
  const envelope = readPendingNetworkEnvelope(instanceId)
  if (!envelope) return null
  const caller = await effectiveImpersonatedOperatorUsername(session, request)
  if (canAccessPendingNetwork(envelope, caller, await liveSessionIsAdmin(session))) return null
  return assertGoadInstanceAccess(session, request, instanceId)
}

/** POST — store snapshot, or take+delete when body `{ "__luxConsumePendingNetwork": true }` */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const session = gate.session

  const { instanceId } = await params
  const rawBody = await request.json().catch(() => null)
  if (
    rawBody &&
    typeof rawBody === "object" &&
    (rawBody as Record<string, unknown>)[LUX_CONSUME_PENDING_BODY_KEY] === true &&
    Object.keys(rawBody as Record<string, unknown>).length === 1
  ) {
    try {
      const denied = await snapshotReadAllows(session, request, instanceId)
      if (denied) return denied
      const snapshot = readUnlinkPendingNetworkSnapshot(instanceId)
      return NextResponse.json({ snapshot: snapshot ?? null })
    } catch (err) {
      if (err instanceof InvalidInstanceIdError) return invalidInstanceResponse()
      throw err
    }
  }

  const snapshot = rawBody
  if (!snapshot || typeof snapshot !== "object") {
    return NextResponse.json({ error: "Invalid snapshot" }, { status: 400 })
  }

  try {
    assertSafeInstanceId(instanceId)
  } catch (err) {
    if (err instanceof InvalidInstanceIdError) return invalidInstanceResponse()
    throw err
  }
  const denied = await assertGoadInstanceAccess(session, request, instanceId)
  if (denied) return denied

  try {
    writePendingNetworkSnapshot(
      instanceId,
      JSON.stringify(snapshot),
      await effectiveImpersonatedOperatorUsername(session, request),
    )
  } catch (err) {
    if (err instanceof InvalidInstanceIdError) return invalidInstanceResponse()
    console.error("[pending-network] write failed:", err)
    logLuxRouteAction(request, session, { outcome: "failure", detail: "Write failed" })
    return NextResponse.json({ error: "Write failed" }, { status: 500 })
  }

  logLuxRouteAction(request, session, { detail: `instanceId=${instanceId} store` })
  return NextResponse.json({ ok: true })
}

/**
 * GET — read the snapshot without consuming it; returns { snapshot } or { snapshot: null }.
 * Consuming is a POST (`__luxConsumePendingNetwork`), so a GET another site
 * triggers cannot delete rules before they are applied.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const session = gate.session

  const { instanceId } = await params
  try {
    const denied = await snapshotReadAllows(session, request, instanceId)
    if (denied) return denied
    return NextResponse.json({ snapshot: readPendingNetworkEnvelope(instanceId)?.snapshot ?? null })
  } catch (err) {
    if (err instanceof InvalidInstanceIdError) return invalidInstanceResponse()
    throw err
  }
}

/** DELETE — discard a pending snapshot without reading it */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const session = gate.session

  const { instanceId } = await params
  try {
    const denied = await snapshotReadAllows(session, request, instanceId)
    if (denied) return denied
    const filePath = pendingNetworkJsonPath(instanceId)
    try { fs.unlinkSync(filePath) } catch { /* file may not exist */ }
  } catch (err) {
    if (err instanceof InvalidInstanceIdError) return invalidInstanceResponse()
    throw err
  }
  logLuxRouteAction(request, session, { detail: `instanceId=${instanceId} discard` })
  return NextResponse.json({ ok: true })
}
