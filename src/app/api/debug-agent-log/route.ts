import fs from "fs"
import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { DATA_DIR } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/session"

// Cap payload at 8 KB to prevent runaway disk writes from buggy clients.
const MAX_PAYLOAD_BYTES = 8 * 1024

const DEBUG_LOG = path.join(DATA_DIR, "debug-agent-log.ndjson")

function appendEntry(payload: Record<string, unknown>): void {
  // Only write when the debug flag is active — no-op in normal operation.
  if (
    process.env.LUX_GOAD_CHAIN_DEBUG !== "1" &&
    process.env.NEXT_PUBLIC_LUX_GOAD_CHAIN_DEBUG !== "1"
  ) {
    return
  }
  try {
    fs.appendFileSync(DEBUG_LOG, `${JSON.stringify(payload)}\n`, "utf8")
  } catch {
    // Non-fatal — debug logging must never break normal flow.
  }
}

/**
 * POST /api/debug-agent-log
 *
 * Authenticated endpoint for client-side debug telemetry. Appends a single
 * NDJSON entry to DATA_DIR/debug-agent-log.ndjson. Writes are skipped unless
 * LUX_GOAD_CHAIN_DEBUG=1, so there is no disk impact in normal operation.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }

  let payload: Record<string, unknown>
  try {
    const text = await request.text()
    if (text.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 })
    }
    payload = JSON.parse(text) as Record<string, unknown>
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return NextResponse.json({ error: "Payload must be a JSON object" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  appendEntry({ ...payload, _user: session.username, _ts: new Date().toISOString() })
  return NextResponse.json({ ok: true })
}
