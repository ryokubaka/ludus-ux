import { NextRequest } from "next/server"
import { resolveSession } from "@/lib/session"
import { getSettings, updateSettings } from "@/lib/settings-store"
import {
  normalizeLlmBaseUrl,
  normalizeOllamaTagsPayload,
  ollamaOriginFromBaseUrl,
} from "@/lib/assistant/llm-client"

export const maxDuration = 600

function modelPresentInTags(tagsJson: unknown, want: string): string | null {
  const list = normalizeOllamaTagsPayload(tagsJson)
  const exact = list.find((m) => m.id === want)
  if (exact) return exact.id
  const prefixed = list.find((m) => m.id === `${want}:latest` || m.id.startsWith(`${want}:`))
  return prefixed?.id || null
}

async function waitForModelInTags(origin: string, want: string, attempts = 12): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000))
    try {
      const res = await fetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) continue
      const json = await res.json().catch(() => null)
      const hit = modelPresentInTags(json, want)
      if (hit) return hit
    } catch {
      /* retry */
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 })
  }
  if (!session.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin only" }), { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string
    setAsDefault?: boolean
    llmBaseUrl?: string
  } | null
  const name = body?.name?.trim()
  if (!name) {
    return new Response(JSON.stringify({ error: "name required" }), { status: 400 })
  }

  const s = getSettings()
  const base = normalizeLlmBaseUrl(body?.llmBaseUrl || s.llmBaseUrl)
  const origin = ollamaOriginFromBaseUrl(base)
  if (!origin) {
    return new Response(
      JSON.stringify({ error: "Model pull requires an Ollama endpoint (e.g. http://ollama:11434/v1)" }),
      { status: 400 },
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          /* closed */
        }
      }
      let sawSuccess = false
      let ollamaError: string | null = null
      try {
        send({ type: "status", status: `Pulling ${name} from Ollama…` })
        const res = await fetch(`${origin}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
          body: JSON.stringify({ name, stream: true }),
        })
        if (!res.ok || !res.body) {
          const t = await res.text().catch(() => "")
          send({ type: "error", message: t.slice(0, 500) || `Ollama pull HTTP ${res.status}` })
          send({ type: "done", ok: false })
          controller.close()
          return
        }

        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ""
        let lineCount = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() || ""
          for (const line of lines) {
            const t = line.trim()
            if (!t) continue
            lineCount++
            try {
              const j = JSON.parse(t) as Record<string, unknown>
              if (typeof j.error === "string" && j.error) {
                ollamaError = j.error
                send({ type: "error", message: j.error })
                continue
              }
              const status = typeof j.status === "string" ? j.status : ""
              if (status) {
                const completed = typeof j.completed === "number" ? j.completed : undefined
                const total = typeof j.total === "number" ? j.total : undefined
                const pct =
                  completed != null && total != null && total > 0
                    ? ` ${Math.min(100, Math.round((completed / total) * 100))}%`
                    : ""
                send({ type: "progress", status: `${status}${pct}` })
              }
              if (status === "success") sawSuccess = true
            } catch {
              send({ type: "progress", status: t.slice(0, 200) })
            }
          }
        }

        if (ollamaError) {
          send({ type: "done", ok: false })
          controller.close()
          return
        }

        // Empty stream / immediate close without success → not a real pull
        if (!sawSuccess && lineCount === 0) {
          send({
            type: "error",
            message: "Ollama returned an empty pull stream — check connectivity and model name",
          })
          send({ type: "done", ok: false })
          controller.close()
          return
        }

        send({ type: "status", status: "Verifying model appears in Ollama tags…" })
        const verified = await waitForModelInTags(origin, name)
        if (!verified) {
          send({
            type: "error",
            message: sawSuccess
              ? `Pull reported success but "${name}" is not in ollama list yet — wait and Refresh models`
              : `Pull finished without success for "${name}" — check docker logs ludus-ux-ollama`,
          })
          send({ type: "done", ok: false })
          controller.close()
          return
        }

        if (body?.setAsDefault) {
          updateSettings({ llmModel: verified })
        }
        send({ type: "done", ok: true, model: verified })
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) })
        send({ type: "done", ok: false })
      } finally {
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
