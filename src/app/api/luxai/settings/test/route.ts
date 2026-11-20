import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/session/require-admin"
import { CURSOR_API_ORIGIN } from "@/lib/luxai/cursor"
import { prepareModelUrl, defaultAddressLookup, fetchModelEndpoint } from "@/lib/luxai/endpoint-policy"
import { interpretProbe, probeRequest, scrubProviderError } from "@/lib/luxai/providers"
import { getLuxaiSettings, loadLuxaiProfiles } from "@/lib/luxai/store"
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
  const stored = loadLuxaiProfiles()[provider]
  const egress: LuxaiEgress = provider === "cursor"
    ? "cloud"
    : record.egress === "cloud" || record.egress === "local" ? record.egress : stored.egress
  const requestedBase = typeof record.baseUrl === "string" && record.baseUrl.trim() ? record.baseUrl.trim() : stored.baseUrl
  const baseUrl = provider === "cursor" ? CURSOR_API_ORIGIN : requestedBase
  const typedKey = typeof record.apiKey === "string" ? record.apiKey.trim() : ""
  const sameEndpoint = egress === stored.egress && baseUrl === stored.baseUrl
  const apiKey = typedKey || (sameEndpoint ? stored.apiKey : "")
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
    response = await fetchModelEndpoint(probe.url, {
      method: "GET",
      headers: probe.headers,
      signal: AbortSignal.timeout(8_000),
    }, egress, defaultAddressLookup, fetch)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed."
    return NextResponse.json({ error: scrubProviderError(message, apiKey) }, { status: 502 })
  }
  const payload = await response.json().catch(() => null)
  const result = interpretProbe(response.status, payload)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
  return finishAdminResponse(NextResponse.json({ ok: true, models: result.models, catalog: result.catalog }), admin)
}
