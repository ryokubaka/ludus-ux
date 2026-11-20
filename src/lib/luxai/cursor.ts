import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { LuxaiModelInfo } from "@/lib/luxai/types"
import type { ProviderRequest, ProviderResult, ToolCall } from "@/lib/luxai/providers"

export const CURSOR_API_ORIGIN = "https://api.cursor.com"

export function cursorHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }
  if (key) headers.Authorization = `Basic ${Buffer.from(`${key}:`).toString("base64")}`
  return headers
}

function scrub(text: string, apiKey: string): string {
  const key = apiKey.trim()
  const cleaned = key.length >= 8 ? text.split(key).join("[redacted]") : text
  return cleaned.slice(0, 500)
}

function contextLabels(tokens: number): string[] {
  const thousands = tokens / 1000
  const labels = [String(tokens), `${thousands}k`, `${thousands}K`]
  if (tokens === 1_000_000) labels.push("1m", "1M", "1000k", "1000K")
  return labels
}

/** Keep only parameters the selected Cursor model lists. */
export function cursorModelParams(input: {
  model: string
  effort: string
  contextWindow: number
  modelParams: Array<{ id: string; value: string }>
  catalog: LuxaiModelInfo[]
}): Array<{ id: string; value: string }> {
  const chosen = new Map<string, string>()
  for (const param of input.modelParams) {
    if (param.id && param.value) chosen.set(param.id, param.value)
  }
  const model = input.catalog.find((item) => item.id === input.model)
  if (!model) return [...chosen.entries()].slice(0, 8).map(([id, value]) => ({ id, value }))
  const out: Array<{ id: string; value: string }> = []
  for (const parameter of model.parameters) {
    let value = chosen.get(parameter.id) || ""
    if (/effort|reasoning/i.test(parameter.id) && input.effort) {
      if (parameter.values.some((item) => item.value === input.effort)) value = input.effort
    }
    if (/context/i.test(parameter.id) && input.contextWindow) {
      const labels = contextLabels(input.contextWindow)
      const match = parameter.values.find((item) => labels.includes(item.value))
      if (match) value = match.value
    }
    if (!value) continue
    if (parameter.values.length > 0 && !parameter.values.some((item) => item.value === value)) continue
    out.push({ id: parameter.id, value })
  }
  return out.slice(0, 8)
}

function isAutoModel(modelId: string, catalog: LuxaiModelInfo[]): boolean {
  const id = modelId.trim().toLowerCase()
  if (id === "auto" || id === "auto-smart") return true
  const found = catalog.find((item) => item.id === modelId)
  return found?.displayName.trim().toLowerCase() === "auto"
}

/**
 * Auto uses the included pool only in Cost mode. Effort, context window, and
 * leftover parameters from another model make Cursor bill prepaid credit.
 * Router (`auto-smart`) defaults to `optimize_for=cost` unless the operator picked another mode.
 */
export function cursorRequestModel(input: {
  model: string
  effort: string
  contextWindow: number
  modelParams: Array<{ id: string; value: string }>
  catalog: LuxaiModelInfo[]
}): { id: string; params?: Array<{ id: string; value: string }> } {
  const id = input.model.trim()
  const found = input.catalog.find((item) => item.id === id)
  if (isAutoModel(id, input.catalog)) {
    const optimize = found?.parameters.find((parameter) => parameter.id === "optimize_for")
    const requested = input.modelParams.find((param) => param.id === "optimize_for")?.value.trim() || ""
    const allowed = new Set((optimize?.values ?? []).map((item) => item.value))
    const router = id.toLowerCase() === "auto-smart" || Boolean(optimize)
    if (requested && (allowed.size === 0 || allowed.has(requested))) {
      return {
        id: id.toLowerCase() === "auto" ? "auto-smart" : id,
        params: [{ id: "optimize_for", value: requested }],
      }
    }
    if (found) {
      const variant = defaultVariant(found)
      if (variant) return variant.params.length > 0 ? { id: found.id, params: variant.params } : { id: found.id }
    }
    if (!router) return { id: "auto" }
    const value = allowed.has("cost") || allowed.size === 0 ? "cost" : [...allowed][0]
    return {
      id: id.toLowerCase() === "auto" ? "auto-smart" : id,
      params: [{ id: "optimize_for", value }],
    }
  }
  const explicit = input.modelParams.some((param) => param.id && param.value)
  if (!explicit && found) {
    const variant = defaultVariant(found)
    if (variant) return variant.params.length > 0 ? { id, params: variant.params } : { id }
  }
  const params = explicit || input.effort || input.contextWindow ? cursorModelParams(input) : []
  return params.length > 0 ? { id, params } : { id }
}

function defaultVariant(model: LuxaiModelInfo): { params: Array<{ id: string; value: string }> } | null {
  const variants = model.variants ?? []
  const chosen = variants.find((variant) => variant.isDefault) ?? (variants.length === 1 ? variants[0] : undefined)
  if (!chosen) return null
  return { params: chosen.params.filter((param) => param.id && param.value).slice(0, 8) }
}

/** Auto on Cost, Grok, and Composer draw from the included pool. Balance and Intelligence do not. */
export function cursorModelUsesIncludedPool(model: { id: string; params?: Array<{ id: string; value: string }> }): boolean {
  const id = model.id.trim().toLowerCase()
  if (id === "auto" || id.startsWith("grok") || id.startsWith("composer")) return true
  if (id !== "auto-smart") return false
  const mode = model.params?.find((param) => param.id === "optimize_for")?.value
  return !mode || mode === "cost"
}

function cursorError(status: number, body: string, apiKey: string, model: { id: string; params?: Array<{ id: string; value: string }> }): string {
  let code = ""
  let message = ""
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }
    if (typeof parsed.error?.code === "string") code = parsed.error.code
    if (typeof parsed.error?.message === "string") message = parsed.error.message
  } catch {
    message = ""
  }
  if (code === "usage_limit_exceeded") {
    if (cursorModelUsesIncludedPool(model)) {
      return "Cursor checked this launch against the prepaid balance, which is empty. Auto on its default, and Grok and Composer, are supposed to use the included pool. The Cloud Agents API still requires prepaid credit before it starts, even for those models, and that check does not read the included pool. A launch from the Cursor app uses the pool. A small prepaid balance lets an API launch through, and Grok or Composer usage after that should still count against the included pool."
    }
    return "Cursor checked this launch against the prepaid balance, which is empty. This model spends that balance. Auto on its default, Grok, and Composer are the included-pool models, but this API still checks prepaid credit before those start too."
  }
  if (message) return scrub(`Cursor returned HTTP ${status}. ${message}`, apiKey)
  return scrub(`Cursor returned HTTP ${status}. ${body.slice(0, 300)}`, apiKey)
}

export function buildCursorPrompt(input: ProviderRequest): string {
  const tools = input.tools.map((tool) => {
    const schema = tool.parameters ? `\narguments ${JSON.stringify(tool.parameters)}` : ""
    return `${tool.name}: ${tool.description}${schema}`
  }).join("\n\n")
  const lines = input.messages.map((message) => {
    if (message.role === "tool") return `TOOL ${message.name}:\n${message.content}`
    if (message.role === "assistant" && "toolCalls" in message && message.toolCalls.length > 0) {
      const calls = message.toolCalls.map((call) => `${call.name} ${call.arguments}`).join("\n")
      return `ASSISTANT:\n${message.content}\n${calls}`
    }
    return `${message.role.toUpperCase()}:\n${message.content}`
  })
  return [
    "You are the language model for one LUXAI turn.",
    "You have no repository. Do not call tools, edit files, run commands, or browse.",
    "Reply with the assistant message only.",
    "When you need a LUX tool, end the reply with one fence named luxai-tools.",
    "The fence body is a JSON array of objects with name and arguments. Use the argument names in each tool schema. The range argument is rangeId. A short host name such as DC01 is enough when that is how the VM name ends.",
    "If a range id, range name, lab, or extension list is missing, call ask_operator. Do not guess them. A rangeId field is shown as a dropdown of this user's ranges. An AD CS configuration field is shown as a dropdown of the configurations LUXAI can set.",
    "Put nothing after the fence.",
    "",
    "LUX tools:",
    tools,
    "",
    "Conversation:",
    lines.join("\n\n"),
  ].join("\n").slice(0, 120_000)
}

export function extractLuxaiTools(text: string): { text: string; toolCalls: ToolCall[] } {
  const match = /```luxai-tools\s*([\s\S]*?)```/i.exec(text)
  if (!match) return { text: text.trim(), toolCalls: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch {
    return { text: text.trim(), toolCalls: [] }
  }
  const list = Array.isArray(parsed) ? parsed : []
  const toolCalls: ToolCall[] = []
  for (const item of list.slice(0, 8)) {
    const record = item as { name?: unknown; arguments?: unknown }
    if (typeof record.name !== "string" || !/^[a-z0-9_]{1,64}$/.test(record.name)) continue
    const args = record.arguments && typeof record.arguments === "object" ? record.arguments : {}
    toolCalls.push({
      id: `cursor_${toolCalls.length + 1}`,
      name: record.name,
      arguments: JSON.stringify(args),
    })
  }
  const visible = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim()
  return { text: visible, toolCalls }
}

function visibleAnswer(text: string): string {
  const cut = text.search(/```luxai-tools/i)
  return (cut >= 0 ? text.slice(0, cut) : text).trimEnd()
}

export interface CursorTurnRequest {
  apiKey: string
  prompt: string
  model: { id: string; params?: Array<{ id: string; value: string }> }
  signal?: AbortSignal
  onPartial?: (partial: { text?: string; reasoning?: string }) => void
}

export type CursorTurnRunner = (request: CursorTurnRequest) => Promise<{ text: string; reasoning?: string }>

let testRunner: CursorTurnRunner | null = null

/** Unit tests substitute the local agent so they do not start one. */
export function setCursorTurnRunnerForTests(runner: CursorTurnRunner | null): void {
  testRunner = runner
}

/** Cursor hides the real failure on `error` when `result` is empty. */
export function cursorFailureDetail(
  result: { result?: string; error?: { message?: string; code?: string } },
  notes: string[],
): string {
  const parts: string[] = []
  const message = result.error?.message?.trim() || ""
  const code = result.error?.code?.trim() || ""
  if (message) parts.push(message)
  if (code && code !== message) parts.push(code)
  for (const note of notes) {
    const text = note.trim()
    if (text && !parts.includes(text)) parts.push(text)
  }
  const body = result.result?.trim() || ""
  if (body && !parts.some((part) => part.includes(body))) parts.push(body)
  return parts.join(" ").slice(0, 500) || "Cursor run failed."
}

function absorb(current: string, chunk: string): string {
  if (!chunk) return current
  if (!current || chunk.startsWith(current)) return chunk
  if (current.endsWith(chunk)) return current
  return current + chunk
}

function eventText(event: { type?: string; text?: string; message?: string | { content?: Array<{ type?: string; text?: string }> } }, kind: "text" | "thinking"): string {
  const blocks = typeof event.message === "object" && event.message ? event.message.content ?? [] : []
  const fromBlocks = blocks
    .filter((block) => block.type === kind || (kind === "thinking" && block.type === "reasoning"))
    .map((block) => block.text || "")
    .join("")
  if (fromBlocks) return fromBlocks
  if (kind === "text" && event.type === "assistant" && event.text) return event.text
  if (kind === "thinking" && (event.type === "thinking" || event.type === "reasoning") && event.text) return event.text
  return ""
}

/** A local agent on this server. It does not call the Cloud Agents API. */
export async function runCursorLocalAgent(request: CursorTurnRequest): Promise<{ text: string; reasoning: string }> {
  const sdk = await import("@cursor/sdk") as {
    Agent: {
      create: (options: Record<string, unknown>) => Promise<{
        send: (message: string) => Promise<{
          stream: () => AsyncIterable<{
            type?: string
            text?: string
            status?: string
            message?: string | { content?: Array<{ type?: string; text?: string }> }
          }>
          wait: () => Promise<{ status?: string; result?: string; error?: { message?: string; code?: string } }>
          cancel?: () => Promise<void>
          supports?: (op: string) => boolean
        }>
        [Symbol.asyncDispose]?: () => Promise<void>
      }>
    }
    JsonlLocalAgentStore: new (directory: string) => unknown
  }
  const cwd = await mkdtemp(path.join(tmpdir(), "luxai-cursor-"))
  const storeDir = await mkdtemp(path.join(tmpdir(), "luxai-cursor-store-"))
  let agent: Awaited<ReturnType<typeof sdk.Agent.create>> | undefined
  try {
    agent = await sdk.Agent.create({
      apiKey: request.apiKey,
      model: request.model,
      tools: [],
      local: {
        cwd,
        store: new sdk.JsonlLocalAgentStore(storeDir),
      },
    })
    const run = await agent.send(request.prompt)
    const cancel = () => {
      if (run.supports?.("cancel") !== false && run.cancel) void run.cancel()
    }
    if (request.signal?.aborted) {
      cancel()
      throw new Error("Stopped.")
    }
    request.signal?.addEventListener("abort", cancel, { once: true })
    let text = ""
    let reasoning = ""
    const notes: string[] = []
    try {
      for await (const event of run.stream()) {
        if (request.signal?.aborted) throw new Error("Stopped.")
        if (event.type === "status" && event.status === "ERROR" && typeof event.message === "string" && event.message.trim()) {
          notes.push(event.message.trim())
        }
        const nextReasoning = eventText(event, "thinking")
        if (nextReasoning) {
          reasoning = absorb(reasoning, nextReasoning)
          request.onPartial?.({ reasoning })
        }
        const nextText = eventText(event, "text")
        if (nextText) {
          text = absorb(text, nextText)
          const visible = visibleAnswer(text)
          if (visible) request.onPartial?.({ text: visible })
        }
      }
      const result = await run.wait()
      if (request.signal?.aborted || result.status === "cancelled") throw new Error("Stopped.")
      if (result.status === "error") {
        throw new Error(cursorFailureDetail(result, notes))
      }
      if (result.result?.trim()) text = result.result
    } finally {
      request.signal?.removeEventListener("abort", cancel)
    }
    return { text, reasoning }
  } catch (err) {
    if (request.signal?.aborted) throw new Error("Stopped.")
    const message = err instanceof Error ? err.message : "Cursor run failed."
    if (/usage_limit_exceeded|prepaid balance/i.test(message)) {
      throw new Error(cursorError(400, JSON.stringify({ error: { code: "usage_limit_exceeded", message } }), request.apiKey, request.model))
    }
    throw new Error(scrub(message, request.apiKey))
  } finally {
    await agent?.[Symbol.asyncDispose]?.().catch(() => undefined)
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
    await rm(storeDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function completeCursor(
  input: ProviderRequest,
  _fetchImpl: typeof fetch = fetch,
): Promise<ProviderResult> {
  const key = input.apiKey.trim()
  if (!key) throw new Error("Cursor needs an API key.")
  const timeout = AbortSignal.timeout(input.timeoutMs)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  const model = cursorRequestModel({
    model: input.model,
    effort: input.effort || "",
    contextWindow: input.contextWindow || 0,
    modelParams: input.modelParams || [],
    catalog: input.catalog || [],
  })
  const prompt = buildCursorPrompt(input)
  const runner = testRunner ?? runCursorLocalAgent
  let turn: { text: string; reasoning?: string }
  try {
    turn = await runner({
      apiKey: key,
      prompt,
      model,
      signal,
      onPartial: (partial) => input.onPartial?.(partial),
    })
  } catch (err) {
    if (input.signal?.aborted) throw new Error("Stopped.")
    const message = err instanceof Error ? err.message : "Cursor run failed."
    if (message === "Stopped.") throw err
    throw new Error(scrub(message, key))
  }
  const extracted = extractLuxaiTools(turn.text || "")
  return {
    text: extracted.text,
    reasoning: (turn.reasoning || "").trim(),
    toolCalls: extracted.toolCalls,
  }
}
