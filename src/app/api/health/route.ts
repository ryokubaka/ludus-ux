import { NextResponse } from "next/server"
import { ensureSourceAutoSyncLoopStarted } from "@/lib/source-auto-sync"

export async function GET() {
  // Docker healthcheck hits this every 30s — keep the source auto-sync timer alive
  // even when instrumentation does not run under the custom ws-server entrypoint.
  ensureSourceAutoSyncLoopStarted()
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() })
}
