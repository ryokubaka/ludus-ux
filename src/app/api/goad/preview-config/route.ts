/**
 * POST /api/goad/preview-config
 *
 * Renders GOAD workspace provider/config.yml from lab + extension Jinja templates
 * (same merge as update_instance_files) without creating a workspace.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session/session"
import { isGoadConfigured } from "@/lib/goad/goad-ssh"
import { renderGoadProviderConfig } from "@/lib/goad/render-goad-provider-config"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"
import { isGoadCatalogName } from "@/lib/goad/goad-wizard-args"

export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!isGoadConfigured()) {
    return NextResponse.json({ error: "GOAD is not configured" }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const { lab, extensions, provider, ipRange, rangeId } = body as {
    lab?: string
    extensions?: string[]
    provider?: string
    ipRange?: string
    rangeId?: string
  }

  if (!lab?.trim()) {
    return NextResponse.json({ error: "lab is required" }, { status: 400 })
  }

  if (!Array.isArray(extensions)) {
    return NextResponse.json({ error: "extensions array is required" }, { status: 400 })
  }

  const labName = lab.trim()
  const providerName = (provider || "ludus").trim() || "ludus"
  if (!isGoadCatalogName(labName) || !isGoadCatalogName(providerName)) {
    return NextResponse.json({ error: "lab and provider must be a single catalog name" }, { status: 400 })
  }
  if (!extensions.every((ext) => typeof ext === "string" && isGoadCatalogName(ext))) {
    return NextResponse.json({ error: "each extension must be a single catalog name" }, { status: 400 })
  }

  const creds =
    session.sshPassword && session.username
      ? { username: session.username, password: session.sshPassword }
      : undefined

  if (!creds) {
    return NextResponse.json(
      { error: "Log in with your SSH password to preview a GOAD config." },
      { status: 503 },
    )
  }

  try {
    const yaml = await renderGoadProviderConfig({
      lab: labName,
      extensions,
      provider: providerName,
      ipRange,
      rangeId,
      creds,
    })
    logLuxRouteAction(request, session, {
      outcome: "success",
      detail: `preview-config lab=${lab} extensions=${extensions.length}`,
    })
    return NextResponse.json({ ok: true, yaml })
  } catch (err) {
    const message = err instanceof Error ? err.message : "preview-config failed"
    logLuxRouteAction(request, session, {
      outcome: "failure",
      detail: `preview-config ${message}`,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
