import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session/session"
import { fetchGoadInstancesForRequest } from "@/lib/goad/fetch-goad-instances-for-request"
import { applyServerTiming } from "@/lib/lux/apply-server-timing"

// Must be dynamic: reads env vars + SSH at runtime.
// Without this Next.js pre-renders at build time (when LUDUS_SSH_HOST is unset)
// and serves a stale { configured: false } response for every subsequent request.

export async function GET(request: NextRequest) {
  const requestStart = performance.now()
  const authStart = performance.now()
  const session = await resolveSession(request)
  const authMs = performance.now() - authStart
  if (!session) {
    return applyServerTiming(NextResponse.json({ error: "Not authenticated" }, { status: 401 }), {
      auth: authMs,
      total: performance.now() - requestStart,
    })
  }

  const result = await fetchGoadInstancesForRequest(request, session)

  if (!result.configured) {
    return applyServerTiming(
      NextResponse.json({
        configured: false,
        instances: [],
        message: result.message,
      }),
      {
        auth: authMs,
        total: performance.now() - requestStart,
      },
    )
  }

  const timing = {
    auth: authMs,
    ...(result.timings
      ? { ssh: result.timings.sshMs, upstream: result.timings.upstreamMs }
      : {}),
    total: performance.now() - requestStart,
  }

  if (result.error) {
    return applyServerTiming(
      NextResponse.json(
        { configured: true, instances: [], error: result.error },
        { status: 500 },
      ),
      timing,
    )
  }

  return applyServerTiming(
    NextResponse.json({ configured: true, instances: result.instances }),
    timing,
  )
}
