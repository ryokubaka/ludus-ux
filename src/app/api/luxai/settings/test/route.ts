import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/session/require-admin"
import { CURSOR_API_ORIGIN } from "@/lib/luxai/cursor"
import { prepareModelUrl, defaultAddressLookup } from "@/lib/luxai/endpoint-policy"
import { interpretProbe, probeRequest, scrubProviderError } from "@/lib/luxai/providers"
import { getLuxaiSettings } from "@/lib/luxai/store"
import type { LuxaiEgress, LuxaiProvider } from "@/lib/luxai/types"

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const body = await request.json().catch(() => null)
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {}
  const saved = getLuxaiSettings()
  const provider: LuxaiProvider = record.provider === "anthropic" || record.provider === "openai" || record.provider === "cursor"
    ? record.provider
    : saved.provider
  const egress: LuxaiEgress = provider === "cursor"
    ? "cloud"
    : record.egress === "cloud" || record.egress === "local" ? record.egress : saved.egress
  const requestedBase = typeof record.baseUrl === "string" && record.baseUrl.trim() ? record.baseUrl.trim() : saved.baseUrl
  const baseUrl = provider === "cursor" ? CURSOR_API_ORIGIN : requestedBase
  const typedKey = typeof record.apiKey === "string" ? record.apiKey.trim() : ""
  const sameEndpoint = provider === saved.provider && egress === saved.egress && baseUrl === saved.baseUrl
  const apiKey = typedKey || (sameEndpoint ? saved.apiKey : "")
  if (!baseUrl) {
    return NextResponse.json({ error: "Set a model URL first." }, { status: 400 })
  }
  if (egress === "cloud" && !apiKey) {
    return NextResponse.json({ error: "A cloud provider needs an API key. Nothing was sent." }, { status: 400 })
  }
  let probeUrl = baseUrl
  try {
    probeUrl = await prepareModelUrl(baseUrl, egress, defaultAddressLookup)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Model URL was refused."
    return NextResponse.json({ error: message }, { status: 400 })
  }
  const probe = probeRequest(provider, probeUrl, apiKey)
  let response: Response
  try {
    response = await fetch(probe.url, {
      method: "GET",
      headers: probe.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed."
    return NextResponse.json({ error: scrubProviderError(message, apiKey) }, { status: 502 })
  }
  if (response.status >= 300 && response.status < 400) {
    return NextResponse.json({ error: "The model URL returned a redirect. LUXAI does not follow redirects." }, { status: 502 })
  }
  const payload = await response.json().catch(() => null)
  const result = interpretProbe(response.status, payload)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
  return finishAdminResponse(NextResponse.json({ ok: true, models: result.models, catalog: result.catalog }), admin)
}
