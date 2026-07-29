import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import {
  llmFetch,
  looksLikeOllamaBaseUrl,
  normalizeLlmBaseUrl,
  ollamaOriginFromBaseUrl,
} from "@/lib/assistant/llm-client"

/** Prefer compose DNS when UI used host.docker.internal (Linux hairpin often fails). */
function candidateBases(raw: string): string[] {
  const base = normalizeLlmBaseUrl(raw)
  if (!base) return []
  const out = [base]
  try {
    const u = new URL(base)
    if (
      (u.hostname === "host.docker.internal" || u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      (u.port === "11434" || looksLikeOllamaBaseUrl(base))
    ) {
      const path = u.pathname.replace(/\/+$/, "") || "/v1"
      const alt = `http://ollama:11434${path === "/" ? "/v1" : path}`
      if (!out.includes(alt)) out.push(alt)
    }
  } catch {
    /* ignore */
  }
  return out
}

export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (!session.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 })

  const body = (await request.json().catch(() => null)) as {
    llmBaseUrl?: string
    llmApiKey?: string
    llmModel?: string
  } | null

  const s = getSettings()
  const apiKey = body?.llmApiKey ?? s.llmApiKey
  const model = (body?.llmModel ?? s.llmModel).trim() || "qwen2.5:14b"
  const bases = candidateBases(body?.llmBaseUrl ?? s.llmBaseUrl)
  if (bases.length === 0) return NextResponse.json({ ok: false, error: "Base URL required" }, { status: 400 })

  const errors: string[] = []
  for (const base of bases) {
    const origin = ollamaOriginFromBaseUrl(base)
    if (origin) {
      try {
        const tags = await fetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(10_000) })
        if (tags.ok) {
          return NextResponse.json({
            ok: true,
            via: "ollama-tags",
            status: tags.status,
            baseUrlUsed: base,
            hint:
              base.includes("ollama:") && (body?.llmBaseUrl || "").includes("host.docker.internal")
                ? "Reached Ollama via compose DNS http://ollama:11434 — prefer that URL in Settings (host.docker.internal hairpins fail on Linux Docker)."
                : undefined,
          })
        }
        errors.push(`${base} /api/tags → HTTP ${tags.status}`)
      } catch (err) {
        errors.push(`${base} /api/tags → ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const models = await llmFetch(base, "/models", { apiKey, timeoutMs: 15_000 })
    if (models.ok) {
      return NextResponse.json({ ok: true, via: "models", status: models.status, baseUrlUsed: base })
    }
    errors.push(`${base} /models → ${models.error || `HTTP ${models.status}`}`)

    const ping = await llmFetch(base, "/chat/completions", {
      apiKey,
      method: "POST",
      timeoutMs: 60_000,
      body: {
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 4,
      },
    })
    if (ping.ok) {
      return NextResponse.json({ ok: true, via: "chat", status: ping.status, baseUrlUsed: base })
    }
    errors.push(`${base} /chat/completions → ${ping.error || `HTTP ${ping.status}`}`)
  }

  return NextResponse.json(
    {
      ok: false,
      error: errors.join(" | "),
      hint: "From the ludus-ux container use http://ollama:11434/v1 (same Compose network). host.docker.internal:11434 often fails on Linux when Ollama is another container.",
    },
    { status: 502 },
  )
}
