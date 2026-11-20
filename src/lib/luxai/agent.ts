import { DEFAULT_LUXAI_PROMPT, historyCharBudget, LUXAI_LIMITS } from "@/lib/luxai/defaults"
import { clipText } from "@/lib/luxai/redact"
import { completeProvider, type ProviderTurn } from "@/lib/luxai/providers"
import { listSkillNames } from "@/lib/luxai/skills"
import type { LuxaiSettings } from "@/lib/luxai/store"
import type { LuxaiStreamEvent } from "@/lib/luxai/types"
import { LUXAI_TOOLS, executeTool, parseToolArguments, type ToolContext } from "@/lib/luxai/tools"

export interface RunControl {
  status: "running" | "paused" | "stopped" | "done"
  steer: string
}

export interface AgentResult {
  text: string
  reasoning: string
  stopped: boolean
}

export interface AgentRunInput {
  settings: LuxaiSettings
  username: string
  history: Array<{ role: "user" | "assistant"; content: string }>
  question: string
  context: ToolContext
  signal?: AbortSignal
  control?: () => RunControl | null
  clearSteer?: () => void
  onEvent: (event: LuxaiStreamEvent) => void
}

/** Newest messages first, and the newest one is kept even when it is the long command output. */
export function fitHistory<T extends { content: string }>(history: T[], budget: number): T[] {
  const kept: T[] = []
  let used = 0
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]
    if (kept.length === 0 && message.content.length > budget) {
      kept.push({ ...message, content: clipText(message.content, Math.max(1, budget)) })
      break
    }
    if (used + message.content.length > budget) break
    used += message.content.length
    kept.push(message)
  }
  kept.reverse()
  return kept
}

export async function runLuxaiAgent(input: AgentRunInput): Promise<AgentResult> {
  const settings = input.settings
  const prompt = settings.systemPrompt.trim() || DEFAULT_LUXAI_PROMPT
  const system = `${prompt}

The signed-in operator is ${input.username}.
Skills: ${listSkillNames().join(", ")}.
Proposals wait on the LUXAI page. You cannot apply them.
A user message that starts with [[luxai-resume]] means a guest command finished and its output is already in the conversation. Continue the request that is still unfinished. A read-only check does not finish a change. If they asked to create a range and deploy it, and the range exists but no deploy has started, propose that deploy. Propose the next step, or stop only when the output shows the request is already done.
A user message that starts with [[luxai-form]] is a form the operator already submitted. Use those values. Do not ask for them again.
Write to them in short sentences. Name the range and what will change, and say that nothing changes until they press Apply. Do not call them the operator, and do not quote proposal ids. A form prompt is one or two sentences: what to choose, and that Continue only saves the answers. Field labels name the value, such as Range, Range id, or VLAN. Do not ask them to type a range id or an AD CS setting.`

  const turns: ProviderTurn[] = [{ role: "system", content: system }]
  const history = fitHistory(input.history.slice(-LUXAI_LIMITS.historyMessages), historyCharBudget(settings.contextWindow))
  for (const message of history) {
    turns.push({ role: message.role, content: message.content })
  }
  turns.push({ role: "user", content: input.question })

  const pieces: string[] = []
  const thoughts: string[] = []
  let toolCalls = 0
  let stopped = false
  let live = ""
  const started = Date.now()
  const deadline = started + Math.min(settings.timeoutSec * settings.maxRounds * 1000, 15 * 60 * 1000)
  let current: AbortController | null = null
  let halt: "stop" | "pause" | "steer" | null = null
  const timer = input.control
    ? setInterval(() => {
        if (!current || current.signal.aborted) return
        const control = input.control?.()
        if (!control || control.status === "stopped") {
          halt = "stop"
          current.abort()
        } else if (control.steer) {
          halt = "steer"
          current.abort()
        } else if (control.status === "paused") {
          halt = "pause"
          current.abort()
        }
      }, 200)
    : null

  const checkpoint = async () => {
    for (;;) {
      if (input.signal?.aborted) {
        stopped = true
        return
      }
      const control = input.control?.()
      if (input.control && !control) {
        stopped = true
        return
      }
      if (!control) return
      if (control.status === "stopped") {
        stopped = true
        return
      }
      if (control.steer) {
        turns.push({ role: "user", content: control.steer })
        input.onEvent({ type: "steer", text: control.steer })
        input.clearSteer?.()
      }
      if (control.status !== "paused") return
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  try {
    for (let round = 0; round < settings.maxRounds; round++) {
      await checkpoint()
      if (stopped) break
      if (Date.now() > deadline) throw new Error("This question reached its time limit.")
      current = new AbortController()
      const signal = input.signal ? AbortSignal.any([input.signal, current.signal]) : current.signal
      input.onEvent({
        type: "status",
        text: round === 0 ? "Asking the model…" : "Using the tool result…",
      })
      let result
      try {
        result = await completeProvider({
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.model,
          effort: settings.effort,
          contextWindow: settings.contextWindow,
          modelParams: settings.modelParams,
          catalog: settings.modelCatalog,
          messages: turns,
          tools: LUXAI_TOOLS,
          timeoutMs: settings.timeoutSec * 1000,
          signal,
          onPartial: (partial) => {
            if (partial.reasoning) {
              input.onEvent({ type: "reasoning", text: [...thoughts, partial.reasoning].filter(Boolean).join("\n\n") })
            }
            if (partial.text) {
              live = partial.text
              input.onEvent({ type: "delta", text: [...pieces, partial.text].filter(Boolean).join("\n\n") })
            }
          },
        })
      } catch (err) {
        const why = halt
        halt = null
        current = null
        if (why === "pause") {
          if (live.trim()) {
            pieces.push(live.trim())
            turns.push({ role: "assistant", content: live.trim() })
            live = ""
          }
          round -= 1
          continue
        }
        if (why === "steer") {
          live = ""
          round -= 1
          continue
        }
        if (why === "stop" || input.signal?.aborted) {
          stopped = true
          if (live.trim()) pieces.push(live.trim())
          break
        }
        throw err
      }
      halt = null
      current = null
      live = ""
      const reasoning = result.reasoning?.trim() || ""
      if (reasoning) {
        thoughts.push(reasoning)
        input.onEvent({ type: "reasoning", text: thoughts.join("\n\n") })
      }
      if (result.toolCalls.length === 0) {
        if (result.text.trim()) pieces.push(result.text.trim())
        const before = turns.length
        await checkpoint()
        if (stopped) break
        if (turns.length > before) {
          round -= 1
          continue
        }
        break
      }
      if (result.text.trim()) pieces.push(result.text.trim())
      turns.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls })
      for (const call of result.toolCalls) {
        await checkpoint()
        if (stopped) break
        if (toolCalls >= settings.maxToolCalls) {
          turns.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: "Tool limit reached. Answer with what you have.",
          })
          input.onEvent({ type: "tool", name: call.name, ok: false })
          continue
        }
        toolCalls += 1
        let args: Record<string, unknown>
        try {
          args = parseToolArguments(call.arguments)
        } catch (err) {
          const message = err instanceof Error ? err.message : "Bad arguments."
          turns.push({ role: "tool", toolCallId: call.id, name: call.name, content: message })
          input.onEvent({ type: "tool", name: call.name, ok: false })
          continue
        }
        const outcome = await executeTool(call.name, args, input.context)
        turns.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: outcome.text.slice(0, LUXAI_LIMITS.toolResultMax),
        })
        input.onEvent({ type: "tool", name: call.name, ok: outcome.ok })
        if (outcome.change) input.onEvent({ type: "pending", change: outcome.change })
      }
    }
  } finally {
    if (timer) clearInterval(timer)
  }

  const text = pieces.join("\n\n") || (stopped ? "Stopped." : "I don't have an answer for that.")
  const shown = stopped && pieces.length > 0 ? `${text}\n\n_Stopped._` : text
  input.onEvent({ type: "delta", text: shown })
  return { text: shown, reasoning: thoughts.join("\n\n"), stopped }
}
