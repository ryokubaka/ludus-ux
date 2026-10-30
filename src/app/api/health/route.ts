import { NextResponse } from "next/server"
import { APP_VERSION } from "@/lib/core/changelog"
import { ensureSourceAutoSyncLoopStarted } from "@/lib/sources/source-auto-sync"
import { ensureDeployLogClockLoopStarted } from "@/lib/logs/deploy-log-clock-recorder"
import { ensureLuxHostCurrent } from "@/lib/lux/lux-host-sync"

export async function GET() {
  // Docker healthcheck hits this every 30s — keep the source auto-sync timer alive
  // even when instrumentation does not run under the custom ws-server entrypoint.
  ensureSourceAutoSyncLoopStarted()
  ensureDeployLogClockLoopStarted()
  void ensureLuxHostCurrent()
  return NextResponse.json({
    status: "ok",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
  })
}
