/**
 * Temporary server-side store for wizard-provided network rules.
 *
 * When a user creates a new GOAD instance via the wizard and provides custom
 * firewall rules, GOAD's internal install process overwrites range-config.yml
 * before those rules can be applied. The wizard persists the network snapshot
 * here; after the GOAD SSH task completes, `goad-pending-network-workflow.ts`
 * consumes it server-side (no need to keep the instance page open). The GET /
 * POST take branches remain for compatibility and admin tooling.
 *
 * Storage: DATA_DIR/pending-network/{instanceId}.json
 * Follows the same pattern as DATA_DIR/tasks/ (metadata in files, not in DB).
 *
 * Clients that need to read+delete the snapshot should POST the same URL with
 * body `{ "__luxConsumePendingNetwork": true }` (see POST handler branch).
 */
import fs from "fs"
import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import {
  PENDING_NETWORK_DIR,
  pendingNetworkJsonPath,
  readUnlinkPendingNetworkSnapshot,
} from "@/lib/goad-pending-network-fs"

export const dynamic = "force-dynamic"

const LUX_CONSUME_PENDING_BODY_KEY = "__luxConsumePendingNetwork"

function takePendingNetworkSnapshot(instanceId: string): NextResponse {
  const snapshot = readUnlinkPendingNetworkSnapshot(instanceId)
  return NextResponse.json({ snapshot: snapshot ?? null })
}

/** POST — store snapshot, or take+delete when body `{ "__luxConsumePendingNetwork": true }` */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = await params
  const rawBody = await request.json().catch(() => null)
  if (
    rawBody &&
    typeof rawBody === "object" &&
    (rawBody as Record<string, unknown>)[LUX_CONSUME_PENDING_BODY_KEY] === true &&
    Object.keys(rawBody as Record<string, unknown>).length === 1
  ) {
    return takePendingNetworkSnapshot(instanceId)
  }

  const snapshot = rawBody
  if (!snapshot || typeof snapshot !== "object") {
    return NextResponse.json({ error: "Invalid snapshot" }, { status: 400 })
  }

  try {
    fs.mkdirSync(PENDING_NETWORK_DIR, { recursive: true })
    fs.writeFileSync(
      pendingNetworkJsonPath(instanceId),
      JSON.stringify({ snapshot, savedAt: Date.now(), username: session.username }),
      "utf8",
    )
  } catch (err) {
    console.error("[pending-network] write failed:", err)
    return NextResponse.json({ error: "Write failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/** GET — read the snapshot (and delete it); returns { snapshot } or { snapshot: null } */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = await params
  const snapshot = readUnlinkPendingNetworkSnapshot(instanceId)
  return NextResponse.json({ snapshot: snapshot ?? null })
}

/** DELETE — discard a pending snapshot without reading it */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = await params
  const filePath = pendingNetworkJsonPath(instanceId)
  try { fs.unlinkSync(filePath) } catch { /* file may not exist */ }
  return NextResponse.json({ ok: true })
}
