/**
 * GET /api/metrics
 *
 * Process-local observability counters for cache hit/miss/stale outcomes.
 * Counters reset when the container restarts. The payload contains no
 * credentials or user data, so it is safe to expose to monitoring.
 */

import { NextResponse } from "next/server"
import { APP_VERSION } from "@/lib/core/changelog"
import { getCacheMetrics } from "@/lib/core/cache-metrics"
import { markRouteDynamic } from "@/lib/core/mark-route-dynamic"

export async function GET() {
  await markRouteDynamic()
  return NextResponse.json({
    status: "ok",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    cache: getCacheMetrics(),
  })
}
