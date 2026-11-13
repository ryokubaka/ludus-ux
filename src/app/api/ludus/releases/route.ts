import { NextRequest, NextResponse } from "next/server"
import { markRouteDynamic } from "@/lib/core/mark-route-dynamic"
import { clearLudusReleasesCache, getLudusReleasesSnapshot } from "@/lib/ludus/ludus-releases-fetch"
import { requireSession } from "@/lib/session/require-session"

export async function GET(request: NextRequest) {
  await markRouteDynamic()
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  if (request.nextUrl.searchParams.get("refresh") === "1") clearLudusReleasesCache()
  const snapshot = await getLudusReleasesSnapshot(gate.session.apiKey)
  return NextResponse.json(snapshot)
}
