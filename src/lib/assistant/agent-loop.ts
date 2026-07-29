import { getSettings } from "@/lib/settings-store"
import {
  defaultLlmStreamTimeoutMs,
  llmFetch,
  llmStreamChat,
  looksLikeOllamaBaseUrl,
  normalizeLlmBaseUrl,
  ollamaOriginFromBaseUrl,
} from "@/lib/assistant/llm-client"
import { loadLudusUxSkillContext } from "@/lib/assistant/skill-loader"
import { ASSISTANT_TOOL_DEFINITIONS, type AssistantToolName } from "@/lib/assistant/openapi-tools"
import { executeAssistantTool, type ToolExecContext } from "@/lib/assistant/tool-executor"
import { buildAssistantSystemPrompt } from "@/lib/assistant/system-prompt"
import { redactSecrets } from "@/lib/assistant/redact-secrets"
import {
  askUserProseNudge,
  looksLikeProseClarification,
} from "@/lib/assistant/prose-clarification"
import { deriveWizardProgress } from "@/lib/assistant/wizard-progress"

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "needs_confirmation"; confirmToken: string; summary: string; detail?: string }
  | {
      type: "needs_input"
      askToken: string
      title: string
      message?: string
      questions: import("@/lib/assistant/ask-user").AskQuestion[]
    }
  | { type: "error"; message: string }
  | { type: "done" }
  | { type: "status"; message: string }
  | { type: "cancelled" }

/** Split streamed content so <think>…</think> goes to thinking, rest to answer. */
function createThinkSplitter() {
  let mode: "out" | "think" = "out"
  let hold = ""
  return {
    push(chunk: string): { thinking: string; content: string } {
      hold += chunk
      let thinking = ""
      let content = ""
      for (;;) {
        if (mode === "out") {
          const i = hold.search(/<think>/i)
          if (i < 0) {
            // Keep a short tail in case of split tags
            if (hold.length > 16) {
              content += hold.slice(0, -16)
              hold = hold.slice(-16)
            }
            break
          }
          content += hold.slice(0, i)
          hold = hold.slice(i).replace(/^<think>/i, "")
          mode = "think"
        } else {
          const i = hold.search(/<\/think>/i)
          if (i < 0) {
            if (hold.length > 16) {
              thinking += hold.slice(0, -16)
              hold = hold.slice(-16)
            }
            break
          }
          thinking += hold.slice(0, i)
          hold = hold.slice(i).replace(/^<\/think>/i, "")
          mode = "out"
        }
      }
      return { thinking, content }
    },
    flush(): { thinking: string; content: string } {
      const thinking = mode === "think" ? hold : ""
      const content = mode === "out" ? hold : ""
      hold = ""
      return { thinking, content }
    },
  }
}

async function resolveModelId(base: string, configured: string): Promise<string> {
  const want = configured.trim() || "qwen2.5:14b"
  if (!looksLikeOllamaBaseUrl(base)) return want
  const origin = ollamaOriginFromBaseUrl(base)
  if (!origin) return want
  try {
    const res = await fetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return want
    const json = (await res.json()) as { models?: Array<{ name?: string }> }
    const names = (json.models || []).map((m) => m.name || "").filter(Boolean)
    if (names.includes(want)) return want
    const prefixed = names.find((n) => n === `${want}:latest` || n.startsWith(`${want}:`))
    if (prefixed) return prefixed
  } catch {
    /* keep configured */
  }
  return want
}

async function* streamCompletion(
  messages: ChatMessage[],
  opts: {
    useTools: boolean
    model: string
    base: string
    apiKey: string
    signal?: AbortSignal
  },
): AsyncGenerator<
  | { kind: "thinking"; text: string }
  | { kind: "token"; text: string }
  | { kind: "status"; message: string }
  | { kind: "message"; message: ChatMessage }
  | { kind: "error"; error: string }
> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: 0.2,
  }
  if (opts.useTools) {
    body.tools = ASSISTANT_TOOL_DEFINITIONS
    body.tool_choice = "auto"
  }
  if (looksLikeOllamaBaseUrl(opts.base)) {
    body.options = { num_ctx: 8192 }
  }

  const splitter = createThinkSplitter()
  let sawDelta = false
  let finalMessage: ChatMessage | null = null
  let streamThinking = ""

  for await (const ev of llmStreamChat(opts.base, body, {
    apiKey: opts.apiKey,
    timeoutMs: defaultLlmStreamTimeoutMs(opts.base),
    signal: opts.signal,
  })) {
    if (ev.kind === "error") {
      yield { kind: "error", error: ev.error }
      return
    }
    if (ev.kind === "delta") {
      sawDelta = true
      if (ev.delta.thinking) {
        streamThinking += ev.delta.thinking
        yield { kind: "thinking", text: ev.delta.thinking }
      }
      if (ev.delta.content) {
        const split = splitter.push(ev.delta.content)
        if (split.thinking) {
          streamThinking += split.thinking
          yield { kind: "thinking", text: split.thinking }
        }
        if (split.content) yield { kind: "token", text: split.content }
      }
      continue
    }
    if (ev.kind === "done") {
      const flushed = splitter.flush()
      if (flushed.thinking) {
        streamThinking += flushed.thinking
        yield { kind: "thinking", text: flushed.thinking }
      }
      if (flushed.content) yield { kind: "token", text: flushed.content }
      if (ev.message.thinking && !streamThinking.includes(ev.message.thinking)) {
        yield { kind: "thinking", text: ev.message.thinking }
      }
      finalMessage = {
        role: "assistant",
        content: ev.message.content,
        tool_calls: ev.message.tool_calls,
      }
    }
  }

  if (finalMessage) {
    yield { kind: "message", message: finalMessage }
    return
  }

  // Stream unsupported / empty — fall back to non-streaming
  if (!sawDelta) {
    if (opts.signal?.aborted) {
      yield { kind: "error", error: "aborted" }
      return
    }
    yield { kind: "status", message: "Streaming unavailable — using full response…" }
    const res = await llmFetch(opts.base, "/chat/completions", {
      apiKey: opts.apiKey,
      method: "POST",
      timeoutMs: defaultLlmStreamTimeoutMs(opts.base),
      body: { ...body, stream: false },
    })
    if (!res.ok) {
      yield { kind: "error", error: res.error || `LLM HTTP ${res.status}` }
      return
    }
    const choice = (res.json as { choices?: Array<{ message?: ChatMessage }> })?.choices?.[0]?.message
    if (!choice) {
      yield { kind: "error", error: "LLM returned no choices" }
      return
    }
    if (choice.content) {
      const split = createThinkSplitter()
      const parts = split.push(choice.content)
      const flush = split.flush()
      const think = (parts.thinking + flush.thinking).trim()
      const text = (parts.content + flush.content).trim()
      if (think) yield { kind: "thinking", text: think }
      if (text) yield { kind: "token", text }
      choice.content = text || null
    }
    yield { kind: "message", message: choice }
  }
}

function isAbortError(error: string | undefined): boolean {
  return !!error && /^(aborted|abort)$/i.test(error.trim())
}

function isTimeoutError(error: string | undefined): boolean {
  return !!error && /^(timeout|timed?\s*out)$/i.test(error.trim())
}

function timeoutUserMessage(base: string): string {
  const mins = Math.round(defaultLlmStreamTimeoutMs(base) / 60_000)
  return looksLikeOllamaBaseUrl(base)
    ? `LLM timed out after ${mins}m with no response. qwen2.5:14b on CPU often needs several minutes for the first reply (large system prompt). Wait and retry, or use a smaller/faster model.`
    : `LLM timed out after ${mins}m with no response. Check the provider and retry.`
}

export async function* runAssistantAgent(opts: {
  userMessages: Array<{ role: "user" | "assistant"; content: string }>
  toolCtx: ToolExecContext
  selectedRangeId?: string | null
  maxToolRounds?: number
  signal?: AbortSignal
}): AsyncGenerator<AgentEvent> {
  // Behavioral prompt first; skill refs second (small models often ignore a long buried preamble).
  const skill = loadLudusUxSkillContext(4_000)
  const system = buildAssistantSystemPrompt({
    skillContext: skill,
    selectedRangeId: opts.selectedRangeId,
  })

  const s = getSettings()
  const base = normalizeLlmBaseUrl(s.llmBaseUrl)
  if (opts.signal?.aborted) {
    yield { type: "cancelled" }
    yield { type: "done" }
    return
  }
  yield { type: "status", message: "Contacting LLM…" }
  const model = await resolveModelId(base, s.llmModel)

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...opts.userMessages.map((m) => ({ role: m.role, content: m.content })),
  ]

  const maxRounds = opts.maxToolRounds ?? 8
  let useTools = true
  let proseAskNudged = false

  for (let round = 0; round < maxRounds; round++) {
    if (opts.signal?.aborted) {
      yield { type: "cancelled" }
      yield { type: "done" }
      return
    }
    yield {
      type: "status",
      message: useTools
        ? `Thinking (round ${round + 1})…`
        : `Thinking without tools (round ${round + 1})…`,
    }

    let message: ChatMessage | null = null
    let error: string | undefined
    let streamedAnswer = false

    const runStream = async function* (msgs: ChatMessage[], withTools: boolean) {
      for await (const ev of streamCompletion(msgs, {
        useTools: withTools,
        model,
        base,
        apiKey: s.llmApiKey,
        signal: opts.signal,
      })) {
        yield ev
      }
    }

    for await (const ev of runStream(messages, useTools)) {
      if (ev.kind === "thinking") yield { type: "thinking", text: ev.text }
      else if (ev.kind === "token") {
        streamedAnswer = true
        yield { type: "token", text: ev.text }
      } else if (ev.kind === "status") yield { type: "status", message: ev.message }
      else if (ev.kind === "error") error = ev.error
      else if (ev.kind === "message") message = ev.message
    }

    if (opts.signal?.aborted || isAbortError(error)) {
      yield { type: "cancelled" }
      yield { type: "done" }
      return
    }

    if (isTimeoutError(error)) {
      yield { type: "error", message: timeoutUserMessage(base) }
      yield { type: "done" }
      return
    }

    if (error && /fetch failed|ECONNRESET|socket|aborted|timeout/i.test(error)) {
      if (useTools) {
        yield {
          type: "status",
          message: "LLM connection failed with tools — retrying without tools…",
        }
        useTools = false
        error = undefined
        message = null
        for await (const ev of runStream(messages, false)) {
          if (ev.kind === "thinking") yield { type: "thinking", text: ev.text }
          else if (ev.kind === "token") {
            streamedAnswer = true
            yield { type: "token", text: ev.text }
          } else if (ev.kind === "status") yield { type: "status", message: ev.message }
          else if (ev.kind === "error") error = ev.error
          else if (ev.kind === "message") message = ev.message
        }
      }
      if (opts.signal?.aborted || isAbortError(error)) {
        yield { type: "cancelled" }
        yield { type: "done" }
        return
      }
      if (isTimeoutError(error)) {
        yield { type: "error", message: timeoutUserMessage(base) }
        yield { type: "done" }
        return
      }
      if (error && /fetch failed|ECONNRESET|socket|aborted|timeout/i.test(error)) {
        const compact: ChatMessage[] = [
          {
            role: "system",
            content:
              "You are the Ludus UX assistant. Speak to the user briefly. Answer their question only. Do not invent versions or API results. Tools unavailable this turn.",
          },
          ...opts.userMessages.map((m) => ({ role: m.role, content: m.content })),
        ]
        yield { type: "status", message: "Retrying with compact prompt…" }
        error = undefined
        message = null
        for await (const ev of runStream(compact, false)) {
          if (ev.kind === "thinking") yield { type: "thinking", text: ev.text }
          else if (ev.kind === "token") {
            streamedAnswer = true
            yield { type: "token", text: ev.text }
          } else if (ev.kind === "status") yield { type: "status", message: ev.message }
          else if (ev.kind === "error") error = ev.error
          else if (ev.kind === "message") message = ev.message
        }
      }
    }

    if (opts.signal?.aborted || isAbortError(error)) {
      yield { type: "cancelled" }
      yield { type: "done" }
      return
    }

    if (isTimeoutError(error)) {
      yield { type: "error", message: timeoutUserMessage(base) }
      yield { type: "done" }
      return
    }

    if (error || !message) {
      yield {
        type: "error",
        message:
          (error || "LLM failed") +
          (looksLikeOllamaBaseUrl(base)
            ? " — Check Ollama (`docker logs ludus-ux-ollama`), model id, and that LUX uses http://ollama:11434/v1."
            : ""),
      }
      yield { type: "done" }
      return
    }

    const toolCalls = message.tool_calls
    if (!toolCalls || toolCalls.length === 0) {
      if (
        useTools &&
        !proseAskNudged &&
        looksLikeProseClarification(message.content)
      ) {
        proseAskNudged = true
        if (!streamedAnswer && message.content) {
          yield { type: "token", text: message.content }
        }
        messages.push({
          role: "assistant",
          content: message.content || "",
        })
        messages.push({
          role: "user",
          content: askUserProseNudge(
            opts.toolCtx.conversationRows
              ? deriveWizardProgress(opts.toolCtx.conversationRows)
              : null,
          ),
        })
        yield {
          type: "status",
          message: "Choices must use ask_user buttons — retrying…",
        }
        continue
      }
      if (!streamedAnswer) {
        if (message.content) yield { type: "token", text: message.content }
        else yield { type: "token", text: "(No response text from model.)" }
      }
      yield { type: "done" }
      return
    }

    if (!useTools) {
      messages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: toolCalls,
      })
      messages.push({
        role: "user",
        content: "Tools are disabled this turn. Reply in plain text only, narrating any thoughts briefly.",
      })
      continue
    }

    yield {
      type: "status",
      message: `Running ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}…`,
    }

    messages.push({
      role: "assistant",
      content: message.content || null,
      tool_calls: toolCalls,
    })

    for (const tc of toolCalls) {
      if (opts.signal?.aborted) {
        yield { type: "cancelled" }
        yield { type: "done" }
        return
      }
      const name = tc.function.name as AssistantToolName
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>
      } catch {
        args = {}
      }
      if (opts.toolCtx.confirmToken && !args.confirmToken) {
        args.confirmToken = opts.toolCtx.confirmToken
      }
      yield { type: "status", message: `Tool: ${name}` }
      yield { type: "tool_start", name, args: redactSecrets(args) }
      const result = await executeAssistantTool(name, args, opts.toolCtx)
      if (opts.signal?.aborted) {
        yield { type: "cancelled" }
        yield { type: "done" }
        return
      }
      const safeResult = redactSecrets(result)
      yield { type: "tool_result", name, result: safeResult }
      yield {
        type: "status",
        message: `Tool ${name} finished`,
      }

      if (
        result &&
        typeof result === "object" &&
        (result as { needsConfirmation?: boolean }).needsConfirmation &&
        typeof (result as { confirmToken?: string }).confirmToken === "string"
      ) {
        yield {
          type: "needs_confirmation",
          confirmToken: (result as { confirmToken: string }).confirmToken,
          summary: String((result as { summary?: string }).summary || name),
          detail:
            typeof (result as { detail?: unknown }).detail === "string"
              ? (result as { detail: string }).detail
              : undefined,
        }
        yield { type: "done" }
        return
      }

      if (
        result &&
        typeof result === "object" &&
        (result as { needsInput?: boolean }).needsInput &&
        typeof (result as { askToken?: string }).askToken === "string"
      ) {
        const prompt = (result as { prompt?: import("@/lib/assistant/ask-user").AskPrompt }).prompt
        yield {
          type: "needs_input",
          askToken: (result as { askToken: string }).askToken,
          title: prompt?.title || "Choose an option",
          message: prompt?.message,
          questions: prompt?.questions || [],
        }
        yield { type: "done" }
        return
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name,
        content: JSON.stringify(safeResult).slice(0, 24_000),
      })
    }
  }

  yield { type: "error", message: "Tool loop limit reached" }
  yield { type: "done" }
}
