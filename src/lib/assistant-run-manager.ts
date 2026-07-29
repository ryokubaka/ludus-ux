/**
 * In-process background assistant runs.
 * Survives browser refresh/navigation; cancelled only via explicit cancel/override
 * or process restart (then conversation is marked interrupted).
 */

import {
  getAssistantConversation,
  markConfirmResolved,
  markPriorConfirmsSuperseded,
  markAskResolved,
  markPriorAsksSuperseded,
  updateAssistantConversation,
  type AssistantChatRow,
} from "@/lib/assistant-conversation-store"
import { runAssistantAgent, type AgentEvent } from "@/lib/assistant/agent-loop"
import { verifyAskToken, verifyConfirmToken } from "@/lib/assistant/assistant-config"
import {
  applyConfirmMode,
  type AssistantConfirmMode,
} from "@/lib/assistant/confirm-policy"
import {
  formatAskAnswersForModel,
  validateAskAnswers,
  type AskAnswers,
} from "@/lib/assistant/ask-user"
import {
  buildWizardContinueText,
  wizardAnswersHistoryContent,
} from "@/lib/assistant/wizard-progress"
import { executeAssistantTool, type ToolExecContext } from "@/lib/assistant/tool-executor"
import { docsCorpusStats, seedLudusDocsCache } from "@/lib/assistant/docs-corpus"
import { kickoffMonitorGuidance } from "@/lib/assistant/kickoff-monitor"
import { formatToolChatDetail, redactSecrets } from "@/lib/assistant/redact-secrets"

export type AssistantRunStatus = "running" | "done" | "cancelled" | "error"

export type AssistantRunEvent = AgentEvent

type EventSubscriber = (ev: AssistantRunEvent, index: number) => void
type CloseSubscriber = (status: AssistantRunStatus) => void

type AssistantRun = {
  id: string
  conversationId: string
  username: string
  status: AssistantRunStatus
  abort: AbortController
  events: AssistantRunEvent[]
  eventSubscribers: Set<EventSubscriber>
  closeSubscribers: Set<CloseSubscriber>
  startedAt: number
  finishedAt: number | null
}

const globalKey = "__lux_assistant_runs__" as const

type GlobalRuns = {
  byId: Map<string, AssistantRun>
  byConversation: Map<string, string>
  docsSeedStarted?: boolean
}

function store(): GlobalRuns {
  const g = globalThis as unknown as Record<string, GlobalRuns | undefined>
  if (!g[globalKey]) {
    g[globalKey] = { byId: new Map(), byConversation: new Map() }
  }
  return g[globalKey]!
}

function ensureLudusDocsSeedInBackground(): void {
  const s = store()
  if (s.docsSeedStarted) return
  s.docsSeedStarted = true
  void (async () => {
    try {
      const stats = docsCorpusStats()
      if ((stats.bySource["ludus-cache"] || 0) > 0) return
      console.log("[assistant] seeding Ludus docs cache from docs.ludus.cloud…")
      const result = await seedLudusDocsCache({ force: false })
      console.log(
        `[assistant] ludus docs seed: fetched=${result.fetched.length} skipped=${result.skipped.length} errors=${result.errors.length}`,
      )
    } catch (err) {
      console.warn("[assistant] ludus docs seed failed:", err instanceof Error ? err.message : err)
    }
  })()
}

function newRunId(): string {
  return `ar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function applyEvent(
  rows: AssistantChatRow[],
  ev: AgentEvent,
  pending: { token: string; summary: string; detail?: string } | null,
): { rows: AssistantChatRow[]; pending: { token: string; summary: string; detail?: string } | null } {
  const copy = [...rows]
  if (ev.type === "status" && ev.message) {
    const last = copy[copy.length - 1]
    if (last?.kind === "status") copy[copy.length - 1] = { kind: "status", text: ev.message }
    else copy.push({ kind: "status", text: ev.message })
    return { rows: copy, pending }
  }
  if (ev.type === "thinking" && ev.text) {
    const last = copy[copy.length - 1]
    if (last?.kind === "thinking") copy[copy.length - 1] = { kind: "thinking", text: last.text + ev.text }
    else copy.push({ kind: "thinking", text: ev.text })
    return { rows: copy, pending }
  }
  if (ev.type === "token" && ev.text) {
    const last = copy[copy.length - 1]
    if (last?.kind === "assistant") copy[copy.length - 1] = { kind: "assistant", text: last.text + ev.text }
    else copy.push({ kind: "assistant", text: ev.text })
    return { rows: copy, pending }
  }
  if (ev.type === "tool_start") {
    copy.push({
      kind: "tool",
      name: ev.name || "tool",
      detail: formatToolChatDetail("→", ev.args ?? {}),
    })
    return { rows: copy, pending }
  }
  if (ev.type === "tool_result") {
    copy.push({
      kind: "tool",
      name: ev.name || "tool",
      detail: formatToolChatDetail("←", ev.result ?? {}),
    })
    return { rows: copy, pending }
  }
  if (ev.type === "needs_confirmation" && ev.confirmToken) {
    const conf = {
      token: ev.confirmToken,
      summary: ev.summary || "Destructive action",
      detail: ev.detail?.trim() ? ev.detail : undefined,
    }
    const withSuperseded = markPriorConfirmsSuperseded(copy)
    withSuperseded.push({
      kind: "confirm",
      token: conf.token,
      summary: conf.summary,
      detail: conf.detail,
    })
    return { rows: withSuperseded, pending: conf }
  }
  if (ev.type === "needs_input" && ev.askToken) {
    const withSuperseded = markPriorAsksSuperseded(copy)
    withSuperseded.push({
      kind: "ask",
      token: ev.askToken,
      title: ev.title || "Choose an option",
      message: ev.message,
      questions: ev.questions || [],
    })
    return { rows: withSuperseded, pending }
  }
  if (ev.type === "error") {
    copy.push({ kind: "assistant", text: ev.message || "Error" })
    return { rows: copy, pending }
  }
  if (ev.type === "cancelled") {
    copy.push({ kind: "status", text: "Cancelled." })
    return { rows: copy, pending: null }
  }
  return { rows: copy, pending }
}

function emit(run: AssistantRun, ev: AssistantRunEvent): void {
  const index = run.events.length
  run.events.push(ev)
  for (const cb of run.eventSubscribers) {
    try {
      cb(ev, index)
    } catch (err) {
      console.warn("[assistant-run] subscriber error:", (err as Error).message)
    }
  }
}

function finish(run: AssistantRun, status: AssistantRunStatus): void {
  if (run.status !== "running") return
  run.status = status
  run.finishedAt = Date.now()
  const s = store()
  if (s.byConversation.get(run.conversationId) === run.id) {
    s.byConversation.delete(run.conversationId)
  }
  const conv = getAssistantConversation(run.conversationId, run.username)
  if (conv?.activeRunId === run.id) {
    updateAssistantConversation(run.conversationId, run.username, {
      status: status === "cancelled" ? "cancelled" : "idle",
      activeRunId: null,
    })
  }
  for (const cb of run.closeSubscribers) {
    try {
      cb(status)
    } catch (err) {
      console.warn("[assistant-run] close subscriber error:", (err as Error).message)
    }
  }
  // Keep finished runs briefly for SSE reconnect.
  setTimeout(() => {
    if (s.byId.get(run.id) === run) s.byId.delete(run.id)
  }, 10 * 60_000)
}

export function getAssistantRun(runId: string): AssistantRun | null {
  return store().byId.get(runId) || null
}

export function getActiveRunForConversation(conversationId: string): AssistantRun | null {
  const id = store().byConversation.get(conversationId)
  if (!id) return null
  const run = store().byId.get(id)
  return run?.status === "running" ? run : null
}

export function subscribeAssistantRun(
  runId: string,
  onEvent: EventSubscriber,
  onClose: CloseSubscriber,
): () => void {
  const run = store().byId.get(runId)
  if (!run) {
    onClose("error")
    return () => {}
  }
  for (let i = 0; i < run.events.length; i++) {
    try {
      onEvent(run.events[i], i)
    } catch {
      /* ignore */
    }
  }
  if (run.status !== "running") {
    onClose(run.status)
    return () => {}
  }
  run.eventSubscribers.add(onEvent)
  run.closeSubscribers.add(onClose)
  return () => {
    run.eventSubscribers.delete(onEvent)
    run.closeSubscribers.delete(onClose)
  }
}

/** Cancel in-flight run for a conversation (or by run id). Returns true if something was aborted. */
export function cancelAssistantRun(opts: {
  conversationId?: string
  runId?: string
  username: string
}): boolean {
  const s = store()
  let run: AssistantRun | undefined
  if (opts.runId) run = s.byId.get(opts.runId)
  else if (opts.conversationId) {
    const id = s.byConversation.get(opts.conversationId)
    if (id) run = s.byId.get(id)
  }
  if (!run || run.username !== opts.username) return false
  if (run.status !== "running") return false
  run.abort.abort()
  return true
}

export async function startAssistantRun(opts: {
  conversationId: string
  username: string
  userText: string
  confirmToken?: string
  selectedRangeId?: string | null
  toolCtx: ToolExecContext
  /** Put userText in the model history but do not show it as a user chat bubble. */
  hideUserText?: boolean
}): Promise<{ runId: string; conversationId: string }> {
  ensureLudusDocsSeedInBackground()
  const conv = getAssistantConversation(opts.conversationId, opts.username)
  if (!conv) throw new Error("Conversation not found")

  // Override: stop previous run for this conversation.
  const existing = getActiveRunForConversation(opts.conversationId)
  if (existing) {
    existing.abort.abort()
    const waitUntil = Date.now() + 8_000
    while (existing.status === "running" && Date.now() < waitUntil) {
      await new Promise((r) => setTimeout(r, 40))
    }
  }

  const fresh = getAssistantConversation(opts.conversationId, opts.username)
  if (!fresh) throw new Error("Conversation not found")

  const history = fresh.rows
    .filter((r): r is { kind: "user" | "assistant"; text: string } => r.kind === "user" || r.kind === "assistant")
    .map((r) => ({ role: r.kind, content: r.text }))
  // ask rows are not in LLM history — inject cumulative wizard answers or the model re-asks prior steps.
  const wizardBlock = wizardAnswersHistoryContent(fresh.rows)
  if (wizardBlock) {
    history.push({ role: "user", content: wizardBlock })
  }
  history.push({ role: "user", content: opts.userText })

  const rows: AssistantChatRow[] = opts.hideUserText
    ? [...fresh.rows, { kind: "status", text: "Following up…" }]
    : [...fresh.rows, { kind: "user", text: opts.userText }]
  const runId = newRunId()
  const abort = new AbortController()
  const run: AssistantRun = {
    id: runId,
    conversationId: opts.conversationId,
    username: opts.username,
    status: "running",
    abort,
    events: [],
    eventSubscribers: new Set(),
    closeSubscribers: new Set(),
    startedAt: Date.now(),
    finishedAt: null,
  }

  const s = store()
  s.byId.set(runId, run)
  s.byConversation.set(opts.conversationId, runId)

  updateAssistantConversation(opts.conversationId, opts.username, {
    rows,
    status: "running",
    activeRunId: runId,
    pendingConfirm: null,
  })

  void (async () => {
    let workingRows = rows
    let pending: { token: string; summary: string; detail?: string } | null = null
    let lastPersist = 0
    let cancelled = false

    const persist = (force = false) => {
      const now = Date.now()
      if (!force && now - lastPersist < 250) return
      lastPersist = now
      updateAssistantConversation(opts.conversationId, opts.username, {
        rows: workingRows,
        pendingConfirm: pending,
        status: "running",
        activeRunId: runId,
      })
    }

    try {
      for await (const ev of runAssistantAgent({
        userMessages: history,
        selectedRangeId: opts.selectedRangeId,
        toolCtx: {
          ...opts.toolCtx,
          confirmToken: opts.confirmToken,
          confirmPolicy: fresh.confirmPolicy,
          conversationRows: fresh.rows,
        },
        signal: abort.signal,
      })) {
        if (ev.type === "cancelled") cancelled = true
        emit(run, ev)
        if (ev.type === "done") continue
        const next = applyEvent(workingRows, ev, pending)
        workingRows = next.rows
        pending = next.pending
        persist(ev.type !== "token" && ev.type !== "thinking")
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const errEv: AgentEvent = { type: "error", message }
      emit(run, errEv)
      const next = applyEvent(workingRows, errEv, pending)
      workingRows = next.rows
      pending = next.pending
      emit(run, { type: "done" })
    } finally {
      persist(true)
      updateAssistantConversation(opts.conversationId, opts.username, {
        rows: workingRows,
        pendingConfirm: pending,
      })
      finish(run, cancelled || abort.signal.aborted ? "cancelled" : "done")
    }
  })()

  return { runId, conversationId: opts.conversationId }
}

/**
 * Resolve a destructive-tool confirmation without asking the LLM to re-call the tool.
 * Fixes the "Confirm → model retries → needsConfirmation again" loop.
 */
export async function resolveAssistantConfirmation(opts: {
  conversationId: string
  username: string
  confirmToken: string
  mode: AssistantConfirmMode | "deny"
  selectedRangeId?: string | null
  toolCtx: ToolExecContext
}): Promise<{ runId: string | null; conversationId: string; denied?: boolean }> {
  const conv = getAssistantConversation(opts.conversationId, opts.username)
  if (!conv) throw new Error("Conversation not found")

  const pending = verifyConfirmToken(opts.confirmToken)
  if (!pending) {
    throw new Error("Confirmation expired or invalid — ask the assistant to retry the action.")
  }

  // Stop any in-flight run for this conversation.
  const existing = getActiveRunForConversation(opts.conversationId)
  if (existing) {
    existing.abort.abort()
    const waitUntil = Date.now() + 8_000
    while (existing.status === "running" && Date.now() < waitUntil) {
      await new Promise((r) => setTimeout(r, 40))
    }
  }

  if (opts.mode === "deny") {
    const rows = markConfirmResolved(conv.rows, opts.confirmToken, "denied")
    rows.push({ kind: "status", text: `Denied: ${pending.method.toUpperCase()} ${pending.path}` })
    updateAssistantConversation(opts.conversationId, opts.username, {
      rows,
      pendingConfirm: null,
      status: "idle",
      activeRunId: null,
    })
    return { runId: null, conversationId: opts.conversationId, denied: true }
  }

  const nextPolicy = applyConfirmMode(conv.confirmPolicy, opts.mode, pending)
  const toolName = pending.surface === "ludus" ? "call_ludus_api" : "call_lux_api"
  const baseArgs =
    pending.args && typeof pending.args === "object"
      ? { ...(pending.args as Record<string, unknown>) }
      : {}
  // Ensure operationId is present for the executor.
  if (!baseArgs.operationId) baseArgs.operationId = pending.operationId

  const result = await executeAssistantTool(toolName, baseArgs, {
    ...opts.toolCtx,
    confirmToken: opts.confirmToken,
    confirmPolicy: nextPolicy,
  })

  // If somehow still blocked, surface error (should not happen with matching token).
  if (
    result &&
    typeof result === "object" &&
    (result as { needsConfirmation?: boolean }).needsConfirmation
  ) {
    throw new Error("Confirmation did not authorize the call — try again or re-request the action.")
  }

  const modeLabel =
    opts.mode === "once"
      ? "Allow once"
      : opts.mode === "allow_op"
        ? "Always allow this"
        : "Allow all this chat"

  let rows = markConfirmResolved(conv.rows, opts.confirmToken, "allowed")
  const resultText = JSON.stringify(redactSecrets(result ?? {})).slice(0, 8_000)
  const monitor = kickoffMonitorGuidance(pending)
  const assistantText = monitor
    ? `${monitor.userBlurb}\n\n(Approved via ${modeLabel}: ${pending.method.toUpperCase()} ${pending.path})`
    : `Ran approved call ${pending.method.toUpperCase()} ${pending.path} (${pending.operationId}).\nResult:\n${resultText}`

  rows = [
    ...rows,
    {
      kind: "status",
      text: `${modeLabel}: ${pending.method.toUpperCase()} ${pending.path} (${pending.operationId})`,
    },
    {
      kind: "tool",
      name: toolName,
      detail: formatToolChatDetail("←", result ?? {}),
    },
    { kind: "assistant", text: assistantText },
  ]

  updateAssistantConversation(opts.conversationId, opts.username, {
    rows,
    pendingConfirm: null,
    confirmPolicy: nextPolicy,
    status: "idle",
    activeRunId: null,
  })

  // Kickoff jobs: continue with strict "do not re-POST" instructions, or skip LLM if none.
  const continueText = monitor
    ? monitor.assistantInstructions
    : "The approved action finished. Summarize the result for the user in plain language. Do not repeat the same destructive call."

  const started = await startAssistantRun({
    conversationId: opts.conversationId,
    username: opts.username,
    userText: continueText,
    selectedRangeId: opts.selectedRangeId,
    hideUserText: true,
    toolCtx: {
      ...opts.toolCtx,
      confirmPolicy: nextPolicy,
      confirmToken: undefined,
    },
  })
  return { runId: started.runId, conversationId: started.conversationId }
}

/**
 * Resolve an interactive ask_user prompt and continue the agent with the answers.
 */
export async function resolveAssistantAsk(opts: {
  conversationId: string
  username: string
  askToken: string
  answers?: AskAnswers
  cancelled?: boolean
  selectedRangeId?: string | null
  toolCtx: ToolExecContext
}): Promise<{ runId: string | null; conversationId: string; cancelled?: boolean }> {
  const conv = getAssistantConversation(opts.conversationId, opts.username)
  if (!conv) throw new Error("Conversation not found")

  const pending = verifyAskToken(opts.askToken)
  if (!pending) {
    throw new Error("Prompt expired or invalid — ask the assistant to ask again.")
  }

  const existing = getActiveRunForConversation(opts.conversationId)
  if (existing) {
    existing.abort.abort()
    const waitUntil = Date.now() + 8_000
    while (existing.status === "running" && Date.now() < waitUntil) {
      await new Promise((r) => setTimeout(r, 40))
    }
  }

  if (opts.cancelled) {
    const rows = markAskResolved(conv.rows, opts.askToken, "cancelled")
    rows.push({ kind: "status", text: `Cancelled prompt: ${pending.prompt.title}` })
    updateAssistantConversation(opts.conversationId, opts.username, {
      rows,
      status: "idle",
      activeRunId: null,
    })
    return { runId: null, conversationId: opts.conversationId, cancelled: true }
  }

  const validated = validateAskAnswers(pending.prompt, opts.answers)
  if (!validated.ok) throw new Error(validated.error)

  const summary = formatAskAnswersForModel(pending.prompt, validated.answers)
  let rows = markAskResolved(conv.rows, opts.askToken, "answered", validated.answers)
  rows = [...rows, { kind: "status", text: `Answered: ${pending.prompt.title}` }]

  updateAssistantConversation(opts.conversationId, opts.username, {
    rows,
    status: "idle",
    activeRunId: null,
  })

  const continueText = buildWizardContinueText({ rows, latestSummary: summary })

  const started = await startAssistantRun({
    conversationId: opts.conversationId,
    username: opts.username,
    userText: continueText,
    selectedRangeId: opts.selectedRangeId,
    hideUserText: true,
    toolCtx: opts.toolCtx,
  })
  return { runId: started.runId, conversationId: started.conversationId }
}

/** If DB says running but no in-memory job (process restart), mark interrupted. */
export function reconcileStaleAssistantRun(conversationId: string, username: string): void {
  const conv = getAssistantConversation(conversationId, username)
  if (!conv || conv.status !== "running") return
  const live = getActiveRunForConversation(conversationId)
  if (live && live.id === conv.activeRunId) return
  const rows = [...conv.rows]
  const last = rows[rows.length - 1]
  if (!(last?.kind === "status" && /server restart|process restart/i.test(last.text))) {
    rows.push({
      kind: "status",
      text: "Interrupted — LUX process restarted while this run was in progress. History kept.",
    })
  }
  updateAssistantConversation(conversationId, username, {
    rows,
    status: "interrupted",
    activeRunId: null,
  })
}
