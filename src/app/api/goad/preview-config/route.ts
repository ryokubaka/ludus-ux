/**
 * POST /api/goad/preview-config
 *
 * Renders GOAD workspace provider/config.yml from lab + extension Jinja templates
 * (same merge as update_instance_files) without creating a workspace.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { sshExec, isGoadConfigured } from "@/lib/goad-ssh"
import { GOAD_PREVIEW_CONFIG_PY } from "@/lib/goad-preview-config-py"
import { getSettings } from "@/lib/settings-store"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!isGoadConfigured()) {
    return NextResponse.json({ error: "GOAD is not configured" }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const { lab, extensions, provider } = body as {
    lab?: string
    extensions?: string[]
    provider?: string
  }

  if (!lab?.trim()) {
    return NextResponse.json({ error: "lab is required" }, { status: 400 })
  }

  if (!Array.isArray(extensions)) {
    return NextResponse.json({ error: "extensions array is required" }, { status: 400 })
  }

  const settings = getSettings()
  const goadPath = settings.goadPath || "/opt/GOAD"
  const providerName = (provider || "ludus").trim() || "ludus"
  const rootCreds = rootPasswordCredsIfSet(settings)
  const userCreds =
    session.sshPassword && session.username
      ? { username: session.username, password: session.sshPassword }
      : undefined
  const creds = rootCreds ?? userCreds

  if (!creds) {
    return NextResponse.json(
      { error: "No SSH credentials available (set root SSH password or log in with SSH password)." },
      { status: 503 },
    )
  }

  const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64")
  const encoded = Buffer.from(GOAD_PREVIEW_CONFIG_PY, "utf-8").toString("base64")
  const cmd = `echo '${encoded}' | base64 -d | python3 - '${b64(goadPath)}' '${b64(lab.trim())}' '${b64(JSON.stringify(extensions))}' '${b64(providerName)}'`

  try {
    const { stdout, stderr, code } = await sshExec(cmd, creds)
    if (code !== 0) {
      logLuxRouteAction(request, session, {
        outcome: "failure",
        detail: `preview-config lab=${lab} exit=${code}`,
      })
      return NextResponse.json(
        { error: `SSH script failed (exit ${code}): ${(stderr || stdout).slice(0, 500)}` },
        { status: 500 },
      )
    }

    const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "{}"
    const parsed = JSON.parse(line) as { ok?: boolean; yaml?: string; error?: string }

    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error || "preview-config failed" },
        { status: 500 },
      )
    }

    logLuxRouteAction(request, session, {
      outcome: "success",
      detail: `preview-config lab=${lab} extensions=${extensions.length}`,
    })
    return NextResponse.json({ ok: true, yaml: parsed.yaml ?? "" })
  } catch (err) {
    logLuxRouteAction(request, session, {
      outcome: "failure",
      detail: `preview-config ${(err as Error).message}`,
    })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
