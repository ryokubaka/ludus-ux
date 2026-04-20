/**
 * Temporary server-side store for wizard-provided network rules.
 *
 * When a user creates a new GOAD instance via the wizard and provides custom
 * firewall rules, GOAD's internal install process overwrites range-config.yml
 * before those rules can be applied. The wizard persists the network snapshot
 * here; goad/[id]/page.tsx reads and deletes it after the GOAD task finishes,
 * then re-applies the rules and triggers a network-tag deploy.
 *
 * Storage: DATA_DIR/pending-network/{instanceId}.json
 * Follows the same pattern as DATA_DIR/tasks/ (metadata in files, not in DB).
 */
import fs from "fs"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { DATA_DIR } from "@/lib/db"

const PENDING_NETWORK_DIR = path.join(DATA_DIR, "pending-network")

function pendingNetworkPath(instanceId: string): string {
  return path.join(PENDING_NETWORK_DIR, `${instanceId}.json`)
}

/** POST — store a wizard network snapshot for this instance */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = await params
  const snapshot = await request.json().catch(() => null)
  if (!snapshot || typeof snapshot !== "object") {
    return NextResponse.json({ error: "Invalid snapshot" }, { status: 400 })
  }

  try {
    fs.mkdirSync(PENDING_NETWORK_DIR, { recursive: true })
    fs.writeFileSync(
      pendingNetworkPath(instanceId),
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
  const filePath = pendingNetworkPath(instanceId)

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ snapshot: null })
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const data = JSON.parse(raw) as { snapshot: Record<string, unknown>; savedAt: number; username?: string }
    fs.unlinkSync(filePath)
    return NextResponse.json({ snapshot: data.snapshot })
  } catch (err) {
    console.error("[pending-network] read failed:", err)
    return NextResponse.json({ snapshot: null })
  }
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
  const filePath = pendingNetworkPath(instanceId)
  try { fs.unlinkSync(filePath) } catch { /* file may not exist */ }
  return NextResponse.json({ ok: true })
}
