import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/session/require-session"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"
import { pruneKnownHostsEntries } from "@/lib/ssh/ssh-known-hosts"

/**
 * POST { hosts: string[] } — runs `ssh-keygen -R <host>` for each distinct host/IP
 * against the LUX server user's ~/.ssh/known_hosts (same machine as Next.js).
 */
export async function POST(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const session = gate.session

  let body: unknown
  try {
    body = await request.json()
  } catch {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "Invalid JSON" })
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const hosts = (body as { hosts?: unknown }).hosts
  if (!Array.isArray(hosts)) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "hosts must be an array" })
    return NextResponse.json({ error: "hosts must be an array of strings" }, { status: 400 })
  }
  const list = hosts.filter((h): h is string => typeof h === "string")
  const result = await pruneKnownHostsEntries(list)
  logLuxRouteAction(request, session, { detail: `hosts=${list.length}` })
  return NextResponse.json({ ok: true, attempted: result.attempted, succeeded: result.succeeded })
}
