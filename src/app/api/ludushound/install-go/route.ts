import { NextRequest, NextResponse } from "next/server"
import { resolveLudushoundSession } from "@/lib/ludushound-session"
import { installGoToolchain, isLudushoundSshConfigured } from "@/lib/ludushound-ssh"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

/** Install official Go toolchain on Ludus host under /usr/local/go (root SSH). */
export async function POST(request: NextRequest) {
  const ctx = await resolveLudushoundSession(request)
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!isLudushoundSshConfigured()) {
    return NextResponse.json(
      { error: "SSH not configured. Set LUDUS_SSH_HOST." },
      { status: 400 },
    )
  }

  const result = await installGoToolchain()
  if (!result.ok) {
    logLuxRouteAction(request, ctx.session, { outcome: "failure", detail: result.detail })
    return NextResponse.json({ error: result.detail }, { status: 500 })
  }

  logLuxRouteAction(request, ctx.session)
  return NextResponse.json({ ok: true, detail: result.detail })
}
