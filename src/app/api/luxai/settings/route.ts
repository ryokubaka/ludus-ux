import { NextRequest, NextResponse } from "next/server"
import { liveSessionIsAdmin } from "@/lib/session/session-admin-check"
import { finishAdminResponse, requireAdmin } from "@/lib/session/require-admin"
import { requireSession } from "@/lib/session/require-session"
import { assertModelBaseUrl, defaultAddressLookup } from "@/lib/luxai/endpoint-policy"
import { cleanCatalog, cleanModelParams } from "@/lib/luxai/providers"
import {
  getLuxaiSettings,
  saveLuxaiSettings,
  toPublicLuxaiSettings,
  type LuxaiSettingsPatch,
} from "@/lib/luxai/store"
import type { LuxaiEgress, LuxaiProvider } from "@/lib/luxai/types"
import { logAppEvent } from "@/lib/logs/app-log"

function asProvider(value: unknown): LuxaiProvider | undefined {
  if (value === "openai" || value === "anthropic" || value === "cursor") return value
  return undefined
}

function asEgress(value: unknown): LuxaiEgress | undefined {
  if (value === "local" || value === "cloud") return value
  return undefined
}

export async function GET(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const canConfigure = await liveSessionIsAdmin(gate.session)
  return NextResponse.json(toPublicLuxaiSettings(getLuxaiSettings(), canConfigure))
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const record = body as Record<string, unknown>
  const current = getLuxaiSettings()
  const patch: LuxaiSettingsPatch = {}
  if (typeof record.enabled === "boolean") patch.enabled = record.enabled
  const provider = asProvider(record.provider)
  if (provider) patch.provider = provider
  const egress = asEgress(record.egress)
  if (egress) patch.egress = egress
  if (typeof record.baseUrl === "string") patch.baseUrl = record.baseUrl
  if (typeof record.model === "string") patch.model = record.model
  if (typeof record.effort === "string") patch.effort = record.effort
  if (typeof record.contextWindow === "number") patch.contextWindow = record.contextWindow
  if (Array.isArray(record.modelParams)) patch.modelParams = cleanModelParams(record.modelParams)
  if (Array.isArray(record.catalog)) patch.modelCatalog = cleanCatalog(record.catalog)
  if (typeof record.apiKey === "string" && record.apiKey.trim()) patch.apiKey = record.apiKey.trim()
  if (record.clearKey === true) patch.clearKey = true
  if (typeof record.maxRounds === "number") patch.maxRounds = record.maxRounds
  if (typeof record.maxToolCalls === "number") patch.maxToolCalls = record.maxToolCalls
  if (typeof record.timeoutSec === "number") patch.timeoutSec = record.timeoutSec
  if (typeof record.systemPrompt === "string") patch.systemPrompt = record.systemPrompt
  if (record.resetPrompt === true) patch.resetPrompt = true

  const baseUrl = (patch.baseUrl ?? current.baseUrl).trim()
  const nextEgress = patch.egress ?? current.egress
  if (baseUrl) {
    try {
      await assertModelBaseUrl(baseUrl, nextEgress, defaultAddressLookup)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Model URL was refused."
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }
  try {
    const saved = saveLuxaiSettings(current, patch)
    logAppEvent("luxai_settings", "LUXAI settings updated", {
      username: admin.session.username,
      outcome: "success",
    })
    return finishAdminResponse(
      NextResponse.json(toPublicLuxaiSettings(saved, true)),
      admin,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save LUXAI settings."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
