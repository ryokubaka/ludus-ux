import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { fetchGoadInstancesForRequest } from "@/lib/fetch-goad-instances-for-request"

// Must be dynamic: reads env vars + SSH at runtime.
// Without this Next.js pre-renders at build time (when LUDUS_SSH_HOST is unset)
// and serves a stale { configured: false } response for every subsequent request.
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  const result = await fetchGoadInstancesForRequest(request, session)

  if (!result.configured) {
    return NextResponse.json({
      configured: false,
      instances: [],
      message: result.message,
    })
  }

  if (result.error) {
    return NextResponse.json(
      { configured: true, instances: [], error: result.error },
      { status: 500 },
    )
  }

  return NextResponse.json({ configured: true, instances: result.instances })
}
