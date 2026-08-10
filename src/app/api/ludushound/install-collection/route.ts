import { NextRequest, NextResponse } from "next/server"
import { resolveLudushoundSession } from "@/lib/ludushound-session"
import { buildLudushoundBinary, probeLudushoundHost } from "@/lib/ludushound-ssh"
import { installLudushoundCollectionFromTarball } from "@/lib/ludushound-ansible-requirements"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

export async function POST(request: NextRequest) {
  const ctx = await resolveLudushoundSession(request)
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { buildBinary?: boolean }
  const probe = await probeLudushoundHost(ctx.creds)
  if (!probe.repoPresent) {
    logLuxRouteAction(request, ctx.session, { outcome: "failure", detail: "repo missing" })
    return NextResponse.json(
      {
        error: `LudusHound repo not found at ${probe.ludushoundPath}. Clone bagelByt3s/LudusHound there first.`,
      },
      { status: 400 },
    )
  }

  if (!probe.binaryPresent || body.buildBinary === true) {
    // buildLudushoundBinary installs Go on the Ludus host when missing.
    const built = await buildLudushoundBinary(undefined)
    if (!built.ok) {
      logLuxRouteAction(request, ctx.session, { outcome: "failure", detail: "build failed" })
      return NextResponse.json({ error: built.error || "go build failed" }, { status: 500 })
    }
  }

  const result = await installLudushoundCollectionFromTarball({
    apiKey: ctx.apiKey,
    linuxUser: ctx.linuxUser,
    creds: ctx.creds,
  })

  if (!result.ok) {
    logLuxRouteAction(request, ctx.session, { outcome: "failure", detail: result.detail })
    return NextResponse.json({ error: result.detail }, { status: 500 })
  }

  logLuxRouteAction(request, ctx.session)
  return NextResponse.json({ ok: true, detail: result.detail })
}
