/** Helpers for OpenAI-compatible / Ollama LLM endpoints. */

export function normalizeLlmBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "")
}

/** Derive Ollama native origin (no /v1) from an OpenAI-compatible base URL. */
export function ollamaOriginFromBaseUrl(baseUrl: string): string | null {
  const base = normalizeLlmBaseUrl(baseUrl)
  if (!base) return null
  try {
    const u = new URL(base)
    const isOllamaHost =
      u.hostname === "ollama" ||
      u.hostname.includes("ollama") ||
      u.port === "11434"
    if (!isOllamaHost) return null
    const path = u.pathname.replace(/\/+$/, "")
    if (path === "/v1" || path.endsWith("/v1")) {
      u.pathname = path.replace(/\/v1$/, "") || "/"
    } else {
      u.pathname = "/"
    }
    return u.href.replace(/\/$/, "") || `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

export function looksLikeOllamaBaseUrl(baseUrl: string): boolean {
  const base = normalizeLlmBaseUrl(baseUrl)
  if (!base) return false
  if (ollamaOriginFromBaseUrl(base) != null) return true
  // host.docker.internal:11434 / localhost:11434 after port publish
  try {
    const u = new URL(base)
    return u.port === "11434" || /ollama/i.test(u.hostname)
  } catch {
    return false
  }
}

export interface LlmModelRow {
  id: string
  name: string
}

export function normalizeOpenAiModelsPayload(data: unknown): LlmModelRow[] {
  // Ollama /v1/models may return { object, data: null } with HTTP 200
  const list =
    data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)
      ? ((data as { data: Array<{ id?: string }> }).data)
      : []
  return list
    .map((m) => {
      const id = typeof m.id === "string" ? m.id : ""
      return id ? { id, name: id } : null
    })
    .filter((x): x is LlmModelRow => !!x)
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function normalizeOllamaTagsPayload(data: unknown): LlmModelRow[] {
  const models =
    data && typeof data === "object" && Array.isArray((data as { models?: unknown }).models)
      ? ((data as { models: Array<{ name?: string; model?: string }> }).models)
      : []
  return models
    .map((m) => {
      const id = (typeof m.name === "string" && m.name) || (typeof m.model === "string" && m.model) || ""
      return id ? { id, name: id } : null
    })
    .filter((x): x is LlmModelRow => !!x)
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function llmFetch(
  baseUrl: string,
  path: string,
  opts: { apiKey?: string; method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json?: unknown; text?: string; error?: string }> {
  const base = normalizeLlmBaseUrl(baseUrl)
  if (!base) return { ok: false, status: 0, error: "LLM base URL is empty" }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`
  const headers: Record<string, string> = { Accept: "application/json" }
  if (opts.apiKey?.trim()) headers.Authorization = `Bearer ${opts.apiKey.trim()}`
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 30_000)
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ac.signal,
    })
    const text = await res.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return { ok: res.ok, status: res.status, json, text, error: res.ok ? undefined : text.slice(0, 400) }
  } catch (err) {
    return { ok: false, status: 0, error: describeFetchFailure(err) }
  } finally {
    clearTimeout(t)
  }
}

export type LlmStreamDelta = {
  content?: string
  /** Some models emit reasoning / "thinking" in delta.reasoning or delta.reasoning_content */
  thinking?: string
}

export type LlmStreamResult =
  | { kind: "delta"; delta: LlmStreamDelta }
  | {
      kind: "done"
      message: {
        role: "assistant"
        content: string | null
        thinking?: string
        tool_calls?: Array<{
          id: string
          type: "function"
          function: { name: string; arguments: string }
        }>
      }
    }
  | { kind: "error"; error: string }

/** Default stream deadline; Ollama/local CPU models often need much longer for first token. */
export function defaultLlmStreamTimeoutMs(baseUrl: string): number {
  return looksLikeOllamaBaseUrl(baseUrl) ? 900_000 : 180_000
}

/**
 * OpenAI-compatible SSE chat completions (`stream: true`).
 * Yields content/thinking deltas, then a final assembled message (incl. tool_calls).
 *
 * Timeout is idle-based: each received chunk resets the timer. User abort → error "aborted";
 * idle deadline → error "timeout" (must not be shown as Cancelled in the UI).
 */
export async function* llmStreamChat(
  baseUrl: string,
  body: Record<string, unknown>,
  opts: { apiKey?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): AsyncGenerator<LlmStreamResult> {
  const base = normalizeLlmBaseUrl(baseUrl)
  if (!base) {
    yield { kind: "error", error: "LLM base URL is empty" }
    return
  }
  if (opts.signal?.aborted) {
    yield { kind: "error", error: "aborted" }
    return
  }
  const url = `${base}/chat/completions`
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  }
  if (opts.apiKey?.trim()) headers.Authorization = `Bearer ${opts.apiKey.trim()}`

  const timeoutMs = opts.timeoutMs ?? defaultLlmStreamTimeoutMs(base)
  const ac = new AbortController()
  let timedOut = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOut = true
      ac.abort()
    }, timeoutMs)
  }
  const onExternalAbort = () => ac.abort()
  opts.signal?.addEventListener("abort", onExternalAbort)
  armIdle()

  const abortError = (): "aborted" | "timeout" =>
    opts.signal?.aborted ? "aborted" : timedOut ? "timeout" : "aborted"

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal: ac.signal,
    })
  } catch (err) {
    if (idleTimer) clearTimeout(idleTimer)
    opts.signal?.removeEventListener("abort", onExternalAbort)
    if (opts.signal?.aborted || timedOut || (err instanceof Error && err.name === "AbortError")) {
      yield { kind: "error", error: abortError() }
      return
    }
    yield { kind: "error", error: describeFetchFailure(err) }
    return
  }

  if (!res.ok || !res.body) {
    if (idleTimer) clearTimeout(idleTimer)
    opts.signal?.removeEventListener("abort", onExternalAbort)
    const text = await res.text().catch(() => "")
    yield { kind: "error", error: text.slice(0, 400) || `LLM HTTP ${res.status}` }
    return
  }

  // Headers arrived — give the model a full idle window for first token / prompt eval.
  armIdle()

  const contentParts: string[] = []
  const thinkingParts: string[] = []
  const toolAcc = new Map<
    number,
    { id: string; name: string; arguments: string }
  >()

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  try {
    for (;;) {
      if (opts.signal?.aborted || timedOut) {
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
        yield { kind: "error", error: abortError() }
        return
      }
      const { done, value } = await reader.read()
      if (done) break
      armIdle()
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop() || ""
      for (const raw of lines) {
        const line = raw.trim()
        if (!line || line.startsWith(":")) continue
        if (!line.startsWith("data:")) continue
        const payload = line.slice(5).trim()
        if (payload === "[DONE]") continue
        let json: unknown
        try {
          json = JSON.parse(payload)
        } catch {
          continue
        }
        const choice = (json as { choices?: Array<{ delta?: Record<string, unknown> }> })?.choices?.[0]
        const delta = choice?.delta
        if (!delta || typeof delta !== "object") continue

        const content = typeof delta.content === "string" ? delta.content : ""
        const thinking =
          (typeof delta.reasoning === "string" && delta.reasoning) ||
          (typeof delta.reasoning_content === "string" && delta.reasoning_content) ||
          (typeof (delta as { thinking?: string }).thinking === "string" &&
            (delta as { thinking: string }).thinking) ||
          ""

        if (content) contentParts.push(content)
        if (thinking) thinkingParts.push(thinking)
        if (content || thinking) {
          yield {
            kind: "delta",
            delta: {
              content: content || undefined,
              thinking: thinking || undefined,
            },
          }
        }

        const tcs = delta.tool_calls
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            if (!tc || typeof tc !== "object") continue
            const idx = typeof (tc as { index?: number }).index === "number" ? (tc as { index: number }).index : 0
            const cur = toolAcc.get(idx) || { id: "", name: "", arguments: "" }
            const id = (tc as { id?: string }).id
            if (typeof id === "string" && id) cur.id = id
            const fn = (tc as { function?: { name?: string; arguments?: string } }).function
            if (fn) {
              if (typeof fn.name === "string" && fn.name) cur.name += fn.name
              if (typeof fn.arguments === "string" && fn.arguments) cur.arguments += fn.arguments
            }
            toolAcc.set(idx, cur)
          }
        }
      }
    }
  } catch (err) {
    if (opts.signal?.aborted || timedOut || (err instanceof Error && err.name === "AbortError")) {
      yield { kind: "error", error: abortError() }
      return
    }
    yield { kind: "error", error: describeFetchFailure(err) }
    return
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    opts.signal?.removeEventListener("abort", onExternalAbort)
  }

  const tool_calls = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v], i) => ({
      id: v.id || `call_${i}`,
      type: "function" as const,
      function: { name: v.name, arguments: v.arguments || "{}" },
    }))
    .filter((t) => t.function.name)

  const content = contentParts.join("") || null
  let finalContent = content
  let thinkFromTags = ""
  if (finalContent && /<think>/i.test(finalContent)) {
    const m = finalContent.match(/<think>([\s\S]*?)<\/think>/i)
    if (m) {
      thinkFromTags = m[1].trim()
      finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() || null
    }
  }

  yield {
    kind: "done",
    message: {
      role: "assistant",
      content: finalContent,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      thinking: [thinkingParts.join(""), thinkFromTags].filter(Boolean).join("\n").trim() || undefined,
    },
  }
}

function describeFetchFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts: string[] = [err.message]
  let c: unknown = err.cause
  for (let i = 0; i < 6 && c instanceof Error; i++) {
    parts.push(c.message)
    c = c.cause
  }
  return parts.join(" — ")
}
