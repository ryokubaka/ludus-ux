import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import {
  llmFetch,
  looksLikeOllamaBaseUrl,
  normalizeLlmBaseUrl,
  normalizeOllamaTagsPayload,
  normalizeOpenAiModelsPayload,
  ollamaOriginFromBaseUrl,
} from "@/lib/assistant/llm-client"

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (!session.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 })

  const s = getSettings()
  // Draft overrides from Settings → AI (unsaved form values)
  const q = request.nextUrl.searchParams
  let base = normalizeLlmBaseUrl(q.get("baseUrl") || s.llmBaseUrl)
  const apiKey =
    (request.headers.get("x-llm-api-key") || "").trim() ||
    (q.get("apiKey") || "").trim() ||
    s.llmApiKey
  if (!base) return NextResponse.json({ error: "LLM base URL not set", models: [] }, { status: 400 })

  // Linux Docker: host.docker.internal → published sibling port often fails; try compose DNS
  const tryBases = [base]
  try {
    const u = new URL(base)
    if (
      (u.hostname === "host.docker.internal" || u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      u.port === "11434"
    ) {
      tryBases.push("http://ollama:11434/v1")
    }
  } catch {
    /* ignore */
  }

  for (const candidate of tryBases) {
    base = candidate
    const origin = ollamaOriginFromBaseUrl(base)
    if (origin || looksLikeOllamaBaseUrl(base)) {
      // Always hit native Ollama origin (/api/tags), never …/v1/api/tags
      const ollamaBase = origin || ollamaOriginFromBaseUrl(base.replace(/\/v1\/?$/, "")) || base.replace(/\/v1\/?$/, "")
      const tags = await fetch(`${ollamaBase.replace(/\/+$/, "")}/api/tags`, {
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null)
      if (tags?.ok) {
        const json = await tags.json().catch(() => null)
        return NextResponse.json({
          provider: "ollama",
          models: normalizeOllamaTagsPayload(json),
          baseUrl: base,
        })
      }
    }

    const res = await llmFetch(base, "/models", { apiKey, timeoutMs: 20_000 })
    if (res.ok) {
      return NextResponse.json({
        provider: "openai-compatible",
        models: normalizeOpenAiModelsPayload(res.json),
        baseUrl: base,
      })
    }
    if (tryBases.length === 1) {
      return NextResponse.json(
        { error: res.error || `HTTP ${res.status}`, models: [], provider: "openai-compatible", baseUrl: base },
        { status: 502 },
      )
    }
  }

  return NextResponse.json(
    {
      error:
        "Cannot reach LLM. From ludus-ux use http://ollama:11434/v1 (Compose DNS). host.docker.internal:11434 often fails on Linux.",
      models: [],
    },
    { status: 502 },
  )
}
