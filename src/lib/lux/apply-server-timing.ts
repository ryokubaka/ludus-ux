import type { NextResponse } from "next/server"
import { serverTimingHeader, type ServerTimingPhase } from "@/lib/lux/server-timing"

/**
 * Attach a `Server-Timing` header when timing is enabled. Returns the same
 * response so route handlers can use it inline.
 */
export function applyServerTiming<T extends NextResponse>(
  response: T,
  phases: Record<string, ServerTimingPhase>,
): T {
  const header = serverTimingHeader(phases)
  if (header) response.headers.set("Server-Timing", header)
  return response
}
