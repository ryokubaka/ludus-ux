import { cursorHeaders, completeCursor } from "@/lib/luxai/cursor"
import {
  anthropicMessagesUrl,
  anthropicModelsUrl,
  defaultAddressLookup,
  fetchModelEndpoint,
  normalizeOpenAiBase,
  type LuxaiEgress,
} from "@/lib/luxai/endpoint-policy"
import { readSse } from "@/lib/luxai/sse"
import type { LuxaiModelInfo, LuxaiModelParameter, LuxaiProvider } from "@/lib/luxai/types"

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export type ProviderTurn =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string }

export interface ProviderResult {
  text: string
  reasoning: string
  toolCalls: ToolCall[]
}

export interface ProviderRequest {
  provider: LuxaiProvider
  baseUrl: string
  apiKey: string
  model: string
  messages: ProviderTurn[]
  tools: ToolSpec[]
  timeoutMs: number
  effort?: string
  contextWindow?: number
  modelParams?: Array<{ id: string; value: string }>
  catalog?: LuxaiModelInfo[]
  egress?: LuxaiEgress
  signal?: AbortSignal
  onPartial?: (partial: { text?: string; reasoning?: string }) => void
}

export function scrubProviderError(text: string, apiKey: string): string {
  const cleaned = apiKey.trim().length >= 8 ? text.split(apiKey.trim()).join("[redacted]") : text
  return cleaned.slice(0, 500)
}

export function buildOpenAiBody(input: ProviderRequest): { url: string; body: Record<string, unknown> } {
  const base = normalizeOpenAiBase(input.baseUrl)
  const messages = input.messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content }
    }
    if (message.role === "assistant" && "toolCalls" in message && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      }
    }
    return { role: message.role, content: message.content }
  })
  const body: Record<string, unknown> = {
    model: input.model,
    messages,
    stream: true,
  }
  if (input.effort) body.reasoning_effort = input.effort
  else body.temperature = 0.2
  if (input.tools.length > 0) {
    body.tools = input.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }
  return { url: `${base}/chat/completions`, body }
}

export function splitThink(text: string): { text: string; reasoning: string } {
  const notes: string[] = []
  const cleaned = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_all, inner: string) => {
    const note = inner.trim()
    if (note) notes.push(note)
    return ""
  }).trim()
  return { text: cleaned, reasoning: notes.join("\n\n") }
}

function asReasoning(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function reasoningChunk(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function parseOpenAiBody(payload: unknown): ProviderResult {
  const choice = (payload as { choices?: Array<{ message?: Record<string, unknown> }> })?.choices?.[0]?.message
  if (!choice) throw new Error("The model response had no message.")
  const rawText = typeof choice.content === "string" ? choice.content : ""
  const split = splitThink(rawText)
  const extra = asReasoning(choice.reasoning_content) || asReasoning(choice.reasoning)
  const rawCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : []
  const toolCalls: ToolCall[] = []
  for (const call of rawCalls) {
    const record = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }
    const name = record.function?.name
    if (typeof record.id !== "string" || typeof name !== "string") continue
    const args = record.function?.arguments
    toolCalls.push({
      id: record.id,
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
    })
  }
  return {
    text: split.text,
    reasoning: [extra, split.reasoning].filter(Boolean).join("\n\n"),
    toolCalls,
  }
}

export function buildAnthropicBody(input: ProviderRequest): { url: string; body: Record<string, unknown> } {
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
  const messages: Array<Record<string, unknown>> = []
  for (const message of input.messages) {
    if (message.role === "system") continue
    if (message.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      }
      const last = messages[messages.length - 1]
      if (last?.role === "user" && Array.isArray(last.content)) {
        ;(last.content as unknown[]).push(block)
      } else {
        messages.push({ role: "user", content: [block] })
      }
      continue
    }
    if (message.role === "assistant" && "toolCalls" in message && message.toolCalls.length > 0) {
      const content: Array<Record<string, unknown>> = []
      if (message.content.trim()) content.push({ type: "text", text: message.content })
      for (const call of message.toolCalls) {
        let inputArgs: unknown = {}
        try {
          inputArgs = JSON.parse(call.arguments)
        } catch {
          inputArgs = {}
        }
        content.push({ type: "tool_use", id: call.id, name: call.name, input: inputArgs })
      }
      messages.push({ role: "assistant", content })
      continue
    }
    messages.push({ role: message.role, content: message.content })
  }
  const budget = thinkingBudget(input.effort)
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: budget + 4096,
    messages,
    stream: true,
  }
  if (input.provider === "anthropic") {
    body.thinking = { type: "enabled", budget_tokens: budget }
  }
  if (system.trim()) body.system = system
  if (input.tools.length > 0) {
    body.tools = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
  }
  return { url: anthropicMessagesUrl(input.baseUrl), body }
}

export function parseAnthropicBody(payload: unknown): ProviderResult {
  const content = (payload as { content?: unknown }).content
  if (!Array.isArray(content)) throw new Error("The model response had no content.")
  const texts: string[] = []
  const thoughts: string[] = []
  const toolCalls: ToolCall[] = []
  for (const block of content) {
    const record = block as { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }
    if (record.type === "thinking" && typeof record.thinking === "string") thoughts.push(record.thinking.trim())
    if (record.type === "text" && typeof record.text === "string") texts.push(record.text)
    if (record.type === "tool_use" && typeof record.id === "string" && typeof record.name === "string") {
      toolCalls.push({
        id: record.id,
        name: record.name,
        arguments: JSON.stringify(record.input ?? {}),
      })
    }
  }
  const split = splitThink(texts.join("\n"))
  return {
    text: split.text,
    reasoning: [thoughts.filter(Boolean).join("\n\n"), split.reasoning].filter(Boolean).join("\n\n"),
    toolCalls,
  }
}

export function thinkingBudget(effort: string | undefined): number {
  switch (effort) {
    case "medium":
      return 4096
    case "high":
      return 8192
    case "xhigh":
      return 16_000
    default:
      return 1024
  }
}

export function providerHeaders(provider: LuxaiProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const key = apiKey.trim()
  if (provider === "anthropic") {
    headers["anthropic-version"] = "2026-10-21"
    if (key) headers["x-api-key"] = key
    return headers
  }
  if (provider === "cursor") return cursorHeaders(key)
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

export function probeRequest(provider: LuxaiProvider, baseUrl: string, apiKey: string): { url: string; headers: Record<string, string> } {
  if (provider === "cursor") {
    return { url: "https://api.cursor.com/v1/models", headers: providerHeaders(provider, apiKey) }
  }
  if (provider === "anthropic") {
    return { url: anthropicModelsUrl(baseUrl), headers: providerHeaders(provider, apiKey) }
  }
  return {
    url: `${normalizeOpenAiBase(baseUrl)}/models`,
    headers: providerHeaders(provider, apiKey),
  }
}

export function cleanCatalog(value: unknown): LuxaiModelInfo[] {
  if (!Array.isArray(value)) return []
  const models: LuxaiModelInfo[] = []
  for (const item of value.slice(0, 40)) {
    if (typeof item === "string" && item.trim()) {
      models.push({ id: item.trim().slice(0, 120), displayName: item.trim().slice(0, 80), parameters: [] })
      continue
    }
    const record = item as { id?: unknown; displayName?: unknown; parameters?: unknown }
    if (typeof record.id !== "string" || !record.id.trim() || record.id.length > 120) continue
    const parameters: LuxaiModelParameter[] = []
    if (Array.isArray(record.parameters)) {
      for (const param of record.parameters.slice(0, 8)) {
        const entry = param as { id?: unknown; displayName?: unknown; values?: unknown }
        if (typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 80) continue
        const values: Array<{ value: string; displayName: string }> = []
        if (Array.isArray(entry.values)) {
          for (const choice of entry.values.slice(0, 16)) {
            const option = choice as { value?: unknown; displayName?: unknown }
            if (typeof option.value !== "string" || !option.value.trim() || option.value.length > 80) continue
            values.push({
              value: option.value.trim(),
              displayName: typeof option.displayName === "string" && option.displayName.trim()
                ? option.displayName.trim().slice(0, 80)
                : option.value.trim(),
            })
          }
        }
        parameters.push({
          id: entry.id.trim(),
          displayName: typeof entry.displayName === "string" && entry.displayName.trim()
            ? entry.displayName.trim().slice(0, 80)
            : entry.id.trim(),
          values,
        })
      }
    }
    const id = record.id.trim()
    const variants: LuxaiModelInfo["variants"] = []
    if (Array.isArray((record as { variants?: unknown }).variants)) {
      for (const entry of ((record as { variants: unknown[] }).variants).slice(0, 8)) {
        const variant = entry as { displayName?: unknown; params?: unknown; isDefault?: unknown }
        const params: Array<{ id: string; value: string }> = []
        if (Array.isArray(variant.params)) {
          for (const param of variant.params.slice(0, 8)) {
            const item = param as { id?: unknown; value?: unknown }
            if (typeof item.id !== "string" || typeof item.value !== "string") continue
            const paramId = item.id.trim()
            const paramValue = item.value.trim()
            if (!paramId || !paramValue || paramId.length > 80 || paramValue.length > 80) continue
            params.push({ id: paramId, value: paramValue })
          }
        }
        variants.push({
          displayName: typeof variant.displayName === "string" && variant.displayName.trim()
            ? variant.displayName.trim().slice(0, 80)
            : id,
          params,
          isDefault: variant.isDefault === true,
        })
      }
    }
    models.push({
      id,
      displayName: typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim().slice(0, 80)
        : id,
      parameters,
      variants: variants.length > 0 ? variants : undefined,
    })
  }
  return models
}

export function cleanModelParams(value: unknown): Array<{ id: string; value: string }> {
  if (!Array.isArray(value)) return []
  const out: Array<{ id: string; value: string }> = []
  for (const item of value.slice(0, 8)) {
    const record = item as { id?: unknown; value?: unknown }
    if (typeof record.id !== "string" || typeof record.value !== "string") continue
    const id = record.id.trim()
    const paramValue = record.value.trim()
    if (!id || !paramValue || id.length > 80 || paramValue.length > 80) continue
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) continue
    out.push({ id, value: paramValue })
  }
  return out
}

export function interpretProbe(
  status: number,
  body: unknown,
): { ok: true; models: string[]; catalog: LuxaiModelInfo[] } | { ok: false; error: string } {
  if (status === 401 || status === 403) return { ok: false, error: "The model server refused the API key." }
  if (status < 200 || status >= 300) return { ok: false, error: `The model server returned HTTP ${status}.` }
  const record = body as { data?: unknown; items?: unknown; models?: unknown }
  const list = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(record.models)
        ? record.models
        : []
  const catalog = cleanCatalog(list)
  return { ok: true, models: catalog.map((item) => item.id), catalog }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error("The model response was larger than 2 MB.")
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function notify(input: ProviderRequest, partial: { text?: string; reasoning?: string }) {
  input.onPartial?.(partial)
}

interface OpenAiStreamState {
  text: string
  reasoning: string
  calls: Map<number, ToolCall>
}

function applyOpenAiEvent(state: OpenAiStreamState, event: unknown, input: ProviderRequest) {
  const choice = (event as { choices?: Array<{ delta?: Record<string, unknown>; message?: Record<string, unknown> }> }).choices?.[0]
  const delta = choice?.delta || choice?.message || {}
  if (typeof delta.content === "string" && delta.content) {
    state.text += delta.content
    notify(input, { text: state.text })
  }
  const thought = reasoningChunk(delta.reasoning_content) || reasoningChunk(delta.reasoning)
  if (thought) {
    state.reasoning += thought
    notify(input, { reasoning: state.reasoning })
  }
  const parts = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
  for (const part of parts) {
    const record = part as { index?: number; id?: string; function?: { name?: string; arguments?: string } }
    const index = record.index ?? 0
    const current = state.calls.get(index) || { id: "", name: "", arguments: "" }
    if (record.id) current.id = record.id
    if (record.function?.name) current.name += record.function.name
    if (record.function?.arguments) current.arguments += record.function.arguments
    state.calls.set(index, current)
  }
}

function finishOpenAi(state: OpenAiStreamState): ProviderResult {
  const split = splitThink(state.text)
  return {
    text: split.text,
    reasoning: [state.reasoning.trim(), split.reasoning].filter(Boolean).join("\n\n"),
    toolCalls: [...state.calls.values()].filter((call) => call.id && call.name),
  }
}

interface AnthropicBlock {
  type: string
  id: string
  name: string
  text: string
}

function applyAnthropicEvent(blocks: AnthropicBlock[], event: unknown, input: ProviderRequest) {
  const record = event as {
    type?: string
    index?: number
    content_block?: { type?: string; id?: string; name?: string; text?: string; thinking?: string }
    delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
  }
  if (record.type === "content_block_start" && record.content_block) {
    blocks.push({
      type: record.content_block.type || "text",
      id: record.content_block.id || "",
      name: record.content_block.name || "",
      text: record.content_block.text || record.content_block.thinking || "",
    })
  }
  if (record.type === "content_block_delta" && record.delta) {
    const block = blocks[record.index ?? blocks.length - 1]
    if (!block) return
    if (record.delta.type === "thinking_delta" && record.delta.thinking) {
      block.text += record.delta.thinking
      notify(input, { reasoning: blocks.filter((item) => item.type === "thinking").map((item) => item.text).join("\n\n") })
    } else if (record.delta.type === "text_delta" && record.delta.text) {
      block.text += record.delta.text
      notify(input, { text: blocks.filter((item) => item.type === "text").map((item) => item.text).join("") })
    } else if (record.delta.partial_json) {
      block.text += record.delta.partial_json
    }
  }
}

function finishAnthropic(blocks: AnthropicBlock[]): ProviderResult {
  const texts = blocks.filter((block) => block.type === "text").map((block) => block.text)
  const thoughts = blocks.filter((block) => block.type === "thinking").map((block) => block.text.trim())
  const split = splitThink(texts.join("\n"))
  const toolCalls = blocks
    .filter((block) => block.type === "tool_use" && block.id && block.name)
    .map((block) => ({ id: block.id, name: block.name, arguments: block.text || "{}" }))
  return {
    text: split.text,
    reasoning: [thoughts.filter(Boolean).join("\n\n"), split.reasoning].filter(Boolean).join("\n\n"),
    toolCalls,
  }
}

async function requestModel(
  input: ProviderRequest,
  url: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<ProviderResult> {
  const timeout = AbortSignal.timeout(input.timeoutMs)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  let response: Response
  try {
    const request = {
      method: "POST",
      headers: providerHeaders(input.provider, input.apiKey),
      body: JSON.stringify(body),
      signal,
    }
    response = input.egress
      ? await fetchModelEndpoint(url, request, input.egress, defaultAddressLookup, fetchImpl)
      : await fetchImpl(url, { ...request, redirect: "manual" })
  } catch (err) {
    if (input.signal?.aborted) throw new Error("Stopped.")
    const message = err instanceof Error ? err.message : "The model request failed."
    throw new Error(scrubProviderError(message, input.apiKey))
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error("The model URL returned a redirect. LUXAI does not follow redirects.")
  }
  const contentType = response.headers.get("content-type") || ""
  if (!response.ok) {
    const raw = await readLimited(response, 2_000_000)
    const error = new Error(scrubProviderError(`The model server returned HTTP ${response.status}. ${raw.slice(0, 300)}`, input.apiKey))
    ;(error as Error & { status?: number; body?: string }).status = response.status
    ;(error as Error & { body?: string }).body = raw
    throw error
  }
  if (contentType.includes("text/event-stream") || contentType.includes("application/x-ndjson")) {
    if (input.provider === "anthropic") {
      const blocks: AnthropicBlock[] = []
      await readSse(response, (data) => {
        try {
          applyAnthropicEvent(blocks, JSON.parse(data), input)
        } catch {
          // Ignore keep-alive lines that are not JSON.
        }
      })
      return finishAnthropic(blocks)
    }
    const state: OpenAiStreamState = { text: "", reasoning: "", calls: new Map() }
    await readSse(response, (data) => {
      try {
        applyOpenAiEvent(state, JSON.parse(data), input)
      } catch {
        // Ignore keep-alive lines that are not JSON.
      }
    })
    return finishOpenAi(state)
  }
  const raw = await readLimited(response, 2_000_000)
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error("The model server did not return JSON.")
  }
  const parsed = input.provider === "anthropic" ? parseAnthropicBody(payload) : parseOpenAiBody(payload)
  if (parsed.reasoning) notify(input, { reasoning: parsed.reasoning })
  if (parsed.text) notify(input, { text: parsed.text })
  return parsed
}

export async function completeProvider(
  input: ProviderRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderResult> {
  if (input.provider === "cursor") return completeCursor(input, fetchImpl)
  const built = input.provider === "anthropic" ? buildAnthropicBody(input) : buildOpenAiBody(input)
  try {
    return await requestModel(input, built.url, built.body, fetchImpl)
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    const body = (err as { body?: string }).body || ""
    if (input.provider === "anthropic" && /thinking/i.test(`${message}\n${body}`)) {
      const retry = { ...built.body }
      delete retry.thinking
      return await requestModel(input, built.url, retry, fetchImpl)
    }
    throw err
  }
}
