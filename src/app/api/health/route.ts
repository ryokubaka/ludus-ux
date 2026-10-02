import { NextResponse } from "next/server"
import { APP_VERSION } from "@/lib/changelog"
import { ensureSourceAutoSyncLoopStarted } from "@/lib/source-auto-sync"
import { ensureLuxHostCurrent } from "@/lib/lux-host-sync"

export async function GET() {
  // Docker healthcheck hits this every 30s — keep the source auto-sync timer alive
  // even when instrumentation does not run under the custom ws-server entrypoint.
  ensureSourceAutoSyncLoopStarted()
  void ensureLuxHostCurrent()
  return NextResponse.json({
    status: "ok",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
  })
}
