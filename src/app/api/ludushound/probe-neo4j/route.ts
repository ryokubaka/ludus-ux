import { NextRequest, NextResponse } from "next/server"
import { resolveLudushoundSession } from "@/lib/ludushound-session"
import { probeNeo4jFromHost } from "@/lib/ludushound-ssh"
import { DEFAULT_NEO4J_PASS, DEFAULT_NEO4J_USER } from "@/lib/ludushound-wizard-args"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

export async function POST(request: NextRequest) {
  const ctx = await resolveLudushoundSession(request)
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as {
    server?: string
    user?: string
    pass?: string
  } | null

  const server = (body?.server || "").trim()
  if (!server) {
    return NextResponse.json({ error: "server is required" }, { status: 400 })
  }

  const result = await probeNeo4jFromHost(
    server,
    (body?.user || DEFAULT_NEO4J_USER).trim(),
    body?.pass ?? DEFAULT_NEO4J_PASS,
    ctx.creds,
  )

  logLuxRouteAction(request, ctx.session, {
    outcome: result.ok ? "success" : "failure",
    detail: result.detail,
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
