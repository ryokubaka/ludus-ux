"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/ui/query-keys"
import { useEffectiveScopeTag } from "@/lib/session/effective-scope-context"
import { useRange } from "@/lib/range/range-context"
import { getImpersonationHeaders } from "@/lib/ui/api"
import { Markdown } from "@/components/luxai/markdown"
import { RangeIdYamlHostnameNote } from "@/components/range/range-id-hostname-note"
import { FirewallRules, NetworkRows, RangeBuildWizard, VmRows } from "@/components/luxai/range-build-wizard"
import { isRangeBuildChoice } from "@/lib/luxai/build-wizard-steps"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/core/utils"
import { statusSurface, statusText, type StatusKind } from "@/lib/ui/status-colors"
import { defaultNetworks, defaultVmRows, parseRangeNetworks, parseRangeRules, parseRangeVms, validateDomain, validateNetworks, validateRangeId, validateRangeName, validateRangeVms, validateRules, type RangeNetworkDraft, type RangeRuleDraft, type RangeVmDraft } from "@/lib/luxai/range-vms"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { guestOutputFailed } from "@/lib/luxai/guest-output"
import { formRecord, parseFormRecord } from "@/lib/luxai/form-record"
import { appliedProposalId, isResumeQuestion, resumeQuestion } from "@/lib/luxai/resume"
import type {
  LuxaiChangeView,
  LuxaiChoice,
  LuxaiMessageView,
  LuxaiModelInfo,
  LuxaiProvider,
  LuxaiProviderPublic,
  LuxaiPublicSettings,
  LuxaiSessionSummary,
  LuxaiStreamEvent,
} from "@/lib/luxai/types"

const STARTERS = [
  { label: "Summarize the ranges I can use.", prompt: "List the ranges I can use and summarize each one." },
  { label: "Which VMs are domain controllers?", prompt: "Read the config for my range and tell me which VMs are domain controllers. If I have more than one range, ask which range." },
  {
    label: "Configure an AD CS lab setting on one of my ranges.",
    prompt: "I want an AD CS lab setting on a range I already have. Ask with the range dropdown and the AD CS configuration dropdown. Show the current template settings first, and wait for me to confirm any change. Do not describe how to use the setting.",
    send: true,
  },
  {
    label: "Build a range.",
    prompt: "Build me a Ludus range.",
    send: true,
  },
]

async function luxaiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const impersonation = getImpersonationHeaders()
  for (const [key, value] of Object.entries(impersonation)) headers.set(key, value)
  return fetch(path, { ...init, headers })
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

interface Pane {
  messages: LuxaiMessageView[]
  changes: LuxaiChangeView[]
  draft: string
  status: "idle" | "running" | "paused"
  runId: string | null
  activity: string
  tools: string[]
  error: string
  choice: LuxaiChoice | null
  job: Promise<void> | null
}

interface SessionPayload {
  messages: LuxaiMessageView[]
  changes: LuxaiChangeView[]
  run: { id: string; status: "running" | "paused"; choice: LuxaiChoice | null } | null
}

function emptyPane(): Pane {
  return {
    messages: [],
    changes: [],
    draft: "",
    status: "idle",
    runId: null,
    activity: "",
    tools: [],
    error: "",
    choice: null,
    job: null,
  }
}

export function LuxaiPageClient() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const scopeTag = useEffectiveScopeTag()
  const { selectRange, refreshRanges } = useRange()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<LuxaiPublicSettings | null>(null)
  const [sessions, setSessions] = useState<LuxaiSessionSummary[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [viewTick, setViewTick] = useState(0)
  const [actingId, setActingId] = useState<string | null>(null)
  const [cardNotes, setCardNotes] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState("")
  const [seenAt, setSeenAt] = useState<Record<string, number>>({})
  const chatScroll = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)
  const panes = useRef(new Map<string, Pane>())
  const blank = useRef(emptyPane())
  const sessionIdRef = useRef<string | null>(null)
  const continued = useRef(new Set<string>())
  const continueRef = useRef<(proposalId: string) => void>(() => {})
  const inflight = useRef(new Map<string, Promise<void>>())

  function bump() {
    setViewTick((value) => value + 1)
  }

  function touch(id: string) {
    if (sessionIdRef.current === id) bump()
  }

  const loadSettings = useCallback(async () => {
    const response = await luxaiFetch("/api/luxai/settings")
    if (!response.ok) return
    setSettings(await response.json())
  }, [])

  const loadSessions = useCallback(async () => {
    const response = await luxaiFetch("/api/luxai/sessions")
    if (!response.ok) return
    const body = await response.json() as { sessions: LuxaiSessionSummary[] }
    setSessions(body.sessions)
  }, [])

  const refreshSession = useCallback(async (id: string) => {
    if (inflight.current.has(id)) return
    const response = await luxaiFetch(`/api/luxai/sessions/${id}`)
    if (!response.ok || inflight.current.has(id)) return
    const body = await response.json() as SessionPayload
    const pane = panes.current.get(id) ?? emptyPane()
    const liveTranscript = pane.messages.some((message) => message.id === "pending-assistant")
    if (!(body.run && liveTranscript)) {
      pane.messages = body.messages
      pane.changes = body.changes
    }
    if (body.run) {
      pane.runId = body.run.id
      pane.status = body.run.status
      pane.choice = body.run.choice ?? pane.choice
    } else {
      pane.runId = null
      pane.status = "idle"
      pane.choice = null
      pane.activity = ""
    }
    panes.current.set(id, pane)
    if (!body.run) {
      const last = body.messages[body.messages.length - 1]
      const proposalId = last?.role === "assistant" ? appliedProposalId(last.content) : ""
      const change = proposalId ? body.changes.find((item) => item.id === proposalId) : undefined
      const needsFollowUp = change?.kind === "guest_command" || (change?.kind === "range_create" && !/deploy started/i.test(last?.content || ""))
      if (proposalId && needsFollowUp && change?.status === "applied" && sessionIdRef.current === id) {
        continueRef.current(proposalId)
      }
    }
    if (sessionIdRef.current === id) bump()
  }, [])

  const openSession = useCallback(async (id: string) => {
    sessionIdRef.current = id
    setSessionId(id)
    rememberSeen(id, Date.now())
    if (inflight.current.has(id)) {
      bump()
      return
    }
    await refreshSession(id)
  }, [refreshSession])

  useEffect(() => {
    void loadSettings()
    void loadSessions()
  }, [loadSettings, loadSessions])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("luxai-seen")
      if (raw) setSeenAt(JSON.parse(raw) as Record<string, number>)
    } catch {
      setSeenAt({})
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadSessions()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [loadSessions])

  function rememberSeen(id: string, at: number) {
    setSeenAt((current) => {
      const next = { ...current, [id]: at }
      sessionStorage.setItem("luxai-seen", JSON.stringify(next))
      return next
    })
  }

  useEffect(() => {
    if (!sessionId || sessionId.startsWith("new:")) return
    const timer = window.setInterval(() => {
      if (inflight.current.has(sessionId)) return
      const current = panes.current.get(sessionId)
      if (!current || current.status === "idle") return
      void refreshSession(sessionId)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [refreshSession, sessionId])

  useEffect(() => {
    const el = chatScroll.current
    if (!el || !stickToBottom.current) return
    el.scrollTop = el.scrollHeight
  }, [viewTick])

  function adopt(from: string, to: string) {
    if (from === to) return
    const pane = panes.current.get(from)
    if (!pane) return
    panes.current.delete(from)
    panes.current.set(to, pane)
    const job = inflight.current.get(from)
    if (job) {
      inflight.current.delete(from)
      inflight.current.set(to, job)
    }
    if (sessionIdRef.current === from) {
      sessionIdRef.current = to
      setSessionId(to)
    }
  }

  function writeAssistant(pane: Pane, patch: Partial<LuxaiMessageView>) {
    const existing = pane.messages.find((message) => message.id === "pending-assistant")
    if (!existing) {
      pane.messages = [...pane.messages, { id: "pending-assistant", role: "assistant", content: "", reasoning: "", createdAt: Date.now(), ...patch }]
      return
    }
    pane.messages = pane.messages.map((message) => message.id === "pending-assistant" ? { ...message, ...patch } : message)
  }

  async function send(text: string) {
    const question = text.trim()
    if (!question) return
    const id = sessionIdRef.current
    const pane = id ? panes.current.get(id) : null
    if (pane && (pane.status === "running" || pane.status === "paused")) {
      await control("steer", question)
      pane.draft = ""
      touch(id!)
      return
    }
    await sendNow(question)
  }

  async function sendNow(question: string) {
    const origin = sessionIdRef.current
    const realOrigin = origin && !origin.startsWith("new:") ? origin : null
    const key = realOrigin ?? `new:${crypto.randomUUID()}`
    const pane = realOrigin ? (panes.current.get(realOrigin) ?? emptyPane()) : blank.current
    if (!realOrigin) blank.current = emptyPane()
    panes.current.set(key, pane)
    pane.status = "running"
    pane.error = ""
    pane.activity = "Sending…"
    pane.tools = []
    pane.choice = null
    pane.draft = ""
    pane.runId = null
    const now = Date.now()
    pane.messages = [
      ...pane.messages,
      { id: `user-${now}`, role: "user", content: question, createdAt: now },
      { id: "pending-assistant", role: "assistant", content: "", reasoning: "", createdAt: now + 1 },
    ]
    sessionIdRef.current = key
    setSessionId(key)
    bump()
    const job = readAnswer(key, question, realOrigin)
    pane.job = job
    inflight.current.set(key, job)
    await job
  }

  continueRef.current = (proposalId: string) => {
    if (continued.current.has(proposalId)) return
    continued.current.add(proposalId)
    void sendNow(resumeQuestion(proposalId))
  }

  async function readAnswer(startKey: string, question: string, requestedSession: string | null) {
    let key = startKey
    const pane = () => panes.current.get(key)
    try {
      const response = await luxaiFetch("/api/luxai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, sessionId: requestedSession }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string }
        throw new Error(body.error || `HTTP ${response.status}`)
      }
      const headerSession = response.headers.get("x-luxai-session")
      const headerRun = response.headers.get("x-luxai-run")
      if (headerSession) {
        adopt(key, headerSession)
        key = headerSession
      }
      const current = pane()
      if (current && headerRun) current.runId = headerRun
      touch(key)
      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response stream.")
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as LuxaiStreamEvent
          const live = pane()
          if (!live) continue
          if (event.type === "session") {
            adopt(key, event.sessionId)
            key = event.sessionId
          } else if (event.type === "run") {
            live.runId = event.runId
          } else if (event.type === "tool") {
            live.tools = [...live.tools, `${event.ok ? "Used" : "Failed"} ${event.name}`]
          } else if (event.type === "pending") {
            live.changes = [...live.changes.filter((change) => change.id !== event.change.id), event.change]
          } else if (event.type === "status") {
            live.activity = event.text
          } else if (event.type === "reasoning") {
            writeAssistant(live, { reasoning: event.text })
            if (live.activity === "Sending…" || live.activity.startsWith("Asking")) live.activity = "Thinking…"
          } else if (event.type === "delta") {
            writeAssistant(live, { content: event.text })
            live.activity = ""
          } else if (event.type === "choice") {
            live.choice = event.choice
            live.activity = ""
          } else if (event.type === "steer") {
            live.messages = live.messages.map((message) => (
              message.id === "pending-assistant" ? { ...message, id: `assistant-${Date.now()}` } : message
            ))
            live.messages = [...live.messages, { id: `steer-${Date.now()}`, role: "user", content: event.text, createdAt: Date.now() }, { id: "pending-assistant", role: "assistant", content: "", reasoning: "", createdAt: Date.now() + 1 }]
          } else if (event.type === "error") {
            live.error = event.error
          }
          touch(key)
        }
      }
    } catch (err) {
      const live = pane()
      if (live) {
        live.error = err instanceof Error ? err.message : "LUXAI failed."
        live.messages = live.messages.filter((message) => message.id !== "pending-assistant")
      }
    } finally {
      const live = pane()
      if (live) {
        live.status = "idle"
        live.activity = ""
        live.job = null
      }
      inflight.current.delete(key)
      if (!key.startsWith("new:")) await refreshSession(key)
      void loadSessions()
      touch(key)
    }
  }

  async function control(action: "pause" | "resume" | "stop" | "steer" | "answer", text?: string, extra?: { choiceId: string; selected: string[]; values?: Record<string, string> }) {
    const id = sessionIdRef.current
    const live = id ? panes.current.get(id) : null
    if (!live?.runId) {
      if (live) live.error = "This answer is not running yet."
      if (id) touch(id)
      return false
    }
    const response = await luxaiFetch(`/api/luxai/runs/${live.runId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, text, choiceId: extra?.choiceId, selected: extra?.selected, values: extra?.values }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      live.error = body.error || `HTTP ${response.status}`
      touch(id!)
      return false
    }
    live.error = ""
    if (action === "pause") live.status = "paused"
    if (action === "resume" || action === "steer") live.status = "running"
    if (action === "stop") live.activity = "Stopping…"
    if (action === "answer") {
      live.choice = null
      live.activity = "Recording the extension choice…"
    }
    touch(id!)
    return true
  }

  async function interrupt(text: string) {
    const question = text.trim()
    if (!question) return
    const id = sessionIdRef.current
    const waiting = id ? panes.current.get(id)?.job : null
    const stopped = await control("stop")
    if (!stopped || !id) return
    if (waiting) await waiting
    await sendNow(question)
  }

  async function act(id: string, action: "apply" | "revert" | "reject", yaml?: string) {
    const live = sessionIdRef.current ? panes.current.get(sessionIdRef.current) : null
    if (live) live.error = ""
    setActingId(id)
    const label = action === "apply" ? "Applying…" : action === "reject" ? "Rejecting…" : "Reverting…"
    setCardNotes((current) => ({ ...current, [id]: label }))
    try {
      const response = await luxaiFetch(`/api/luxai/changes/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, yaml }),
      })
      const body = await response.json().catch(() => ({})) as {
        error?: string
        detail?: string
        status?: string
        navigate?: { href?: string; rangeId?: string }
      }
      const note = body.error || body.detail || (response.ok ? "Done." : `HTTP ${response.status}`)
      setCardNotes((current) => ({ ...current, [id]: note }))
      if (!response.ok && live) live.error = body.error || `HTTP ${response.status}`
      const href = body.navigate?.href
      const rangeId = body.navigate?.rangeId
      if (response.ok && href) {
        if (rangeId) {
          await refreshRanges()
          if (href === "/") {
            await queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, rangeId) })
          }
          selectRange(rangeId)
        }
        router.push(href)
      }
    } catch (err) {
      const note = err instanceof Error ? err.message : "The request failed."
      setCardNotes((current) => ({ ...current, [id]: note }))
      if (live) live.error = note
    } finally {
      if (sessionId) await openSession(sessionId)
      setActingId(null)
    }
  }

  async function renameSession(id: string, title: string) {
    const response = await luxaiFetch(`/api/luxai/sessions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", title }),
    })
    const body = await response.json().catch(() => ({})) as { title?: string }
    if (!response.ok || !body.title) return
    setSessions((current) => current.map((session) => session.id === id ? { ...session, title: body.title || title } : session))
  }

  async function archiveSession(id: string, archived: boolean) {
    const response = await luxaiFetch(`/api/luxai/sessions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: archived ? "archive" : "restore" }),
    })
    if (!response.ok) return
    await loadSessions()
  }

  async function removeSession(id: string) {
    if (!window.confirm("Delete this chat?")) return
    const response = await luxaiFetch(`/api/luxai/sessions/${id}`, { method: "DELETE" })
    if (!response.ok) return
    panes.current.delete(id)
    if (sessionIdRef.current === id) {
      sessionIdRef.current = null
      setSessionId(null)
      blank.current = emptyPane()
    }
    await loadSessions()
  }

  function visible() {
    const id = sessionIdRef.current
    if (!id) return blank.current
    return panes.current.get(id) ?? blank.current
  }

  function exportChat() {
    const body = visible().messages.map((message) => {
      const thinking = message.reasoning?.trim() ? `> Thinking\n>\n> ${message.reasoning.trim().replace(/\n/g, "\n> ")}\n\n` : ""
      const savedForm = parseFormRecord(message.content)
      const content = savedForm
        ? `Form: ${savedForm.prompt}`
        : isResumeQuestion(message.content) ? "Command finished. Continuing the request." : message.content
      return `## ${message.role === "user" ? "You" : "LUXAI"}\n\n${thinking}${content}`
    }).join("\n\n")
    const blob = new Blob([body], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "luxai-chat.md"
    link.click()
    URL.revokeObjectURL(url)
  }

  function submitDraft() {
    const live = visible()
    if (!live.draft.trim()) return
    if (live.status === "running" || live.status === "paused") {
      void control("steer", live.draft.trim()).then(() => {
        live.draft = ""
        bump()
      })
      return
    }
    void send(live.draft)
  }

  void viewTick
  const pane = sessionId ? (panes.current.get(sessionId) ?? blank.current) : blank.current
  const messages = pane.messages
  const changes = pane.changes
  const draft = pane.draft
  const error = pane.error
  const activity = pane.activity
  const tools = pane.tools
  const busy = pane.status === "running" || pane.status === "paused"
  const paused = pane.status === "paused"
  const currentTitle = sessions.find((session) => session.id === sessionId)?.title ?? ""

  return (
    <div className="grid h-[calc(100vh-7rem)] min-h-[36rem] grid-cols-1 gap-3 p-4 lg:grid-cols-[20rem_1fr]">
      <Card className="flex min-h-0 flex-col">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Chats</CardTitle>
          {settings?.canConfigure ? (
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">Model</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Model connection</DialogTitle>
                </DialogHeader>
                {settings ? <SettingsForm settings={settings} onSaved={loadSettings} /> : null}
              </DialogContent>
            </Dialog>
          ) : null}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
          <Button variant="outline" size="sm" onClick={() => { sessionIdRef.current = null; setSessionId(null); blank.current = emptyPane(); bump() }}>
            New chat
          </Button>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto">
            {sessions.filter((session) => !session.archived).length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">No chats yet. Start one from the suggestions, or type a request.</p>
            ) : null}
            {sessions.filter((session) => !session.archived).map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === sessionId}
                seenAt={seenAt[session.id] ?? 0}
                onOpen={() => void openSession(session.id)}
                onArchive={() => void archiveSession(session.id, true)}
                onRename={(title) => void renameSession(session.id, title)}
                onDelete={() => void removeSession(session.id)}
              />
            ))}
            {sessions.some((session) => session.archived) ? (
              <details className="rounded-md border border-border px-2 py-1">
                <summary className="cursor-pointer text-xs text-muted-foreground">Archived</summary>
                <div className="mt-2 space-y-2">
                  {sessions.filter((session) => session.archived).map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      active={session.id === sessionId}
                      seenAt={seenAt[session.id] ?? 0}
                      onOpen={() => void openSession(session.id)}
                      onArchive={() => void archiveSession(session.id, false)}
                      archiveLabel="Restore"
                      onRename={(title) => void renameSession(session.id, title)}
                      onDelete={() => void removeSession(session.id)}
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex min-h-0 flex-col gap-3">
        {!settings?.ready ? (
          <p className="text-sm text-muted-foreground">
            LUXAI is off until an admin opens Model and enables it. Chats stay on this server. Range changes wait for Apply.
          </p>
        ) : null}
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                {currentTitle ? (
                  <p className="truncate text-sm font-medium" title={currentTitle}>{currentTitle}</p>
                ) : null}
                <div className="text-xs text-muted-foreground">
                {busy ? (paused ? "Paused" : "Working") : "Ready"}
                {tools.length > 0 ? ` · ${tools.join(" · ")}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" variant="outline" disabled={messages.length === 0} onClick={exportChat}>Export</Button>
                {busy && !paused ? <Button type="button" size="sm" variant="outline" onClick={() => void control("pause")}>Pause</Button> : null}
                {busy && paused ? <Button type="button" size="sm" variant="outline" onClick={() => void control("resume")}>Resume</Button> : null}
                {busy ? <Button type="button" size="sm" variant="destructive" onClick={() => void control("stop")}>Stop</Button> : null}
              </div>
            </div>
            <div
              ref={chatScroll}
              className="min-h-0 flex-1 space-y-3 overflow-auto pr-1"
              onScroll={() => {
                const el = chatScroll.current
                if (!el) return
                stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
              }}
            >
              {messages.length === 0 ? (
                <div className="space-y-2">
                  {STARTERS.map((starter) => (
                    <Button
                      key={starter.label}
                      type="button"
                      variant="outline"
                      className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left text-sm font-normal"
                      onClick={() => {
                        if (starter.send) {
                          void send(starter.prompt)
                          return
                        }
                        visible().draft = starter.prompt
                        bump()
                      }}
                    >
                      {starter.label}
                    </Button>
                  ))}
                </div>
              ) : null}
              {conversationItems(messages, changes).map((item) => (
                item.kind === "message" ? (
                  <ChatBubble
                    key={item.message.id}
                    message={item.message}
                    activity={item.message.id === "pending-assistant" && !item.message.content ? activity : ""}
                    copied={copied === item.message.id}
                    onCopy={() => {
                      void copyText(item.message.content).then(() => {
                        setCopied(item.message.id)
                        window.setTimeout(() => setCopied(""), 1500)
                      })
                    }}
                  />
                ) : (
                  <ChangeCard
                    key={item.change.id}
                    change={item.change}
                    acting={actingId === item.change.id}
                    note={cardNotes[item.change.id] || ""}
                    onAct={act}
                  />
                )
              ))}
            </div>
            {busy && activity ? <p className={cn("flex items-center gap-2 text-xs", statusText("info"))}><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-status-info" />{activity}</p> : null}
            {pane.choice ? (
              isRangeBuildChoice(pane.choice) ? (
              <RangeBuildWizard
                key={pane.choice.id}
                choice={pane.choice}
                onSubmit={(selected, values) => {
                  const answered = pane.choice
                  if (answered) {
                    pane.messages = [...pane.messages, {
                      id: `form-${answered.id}`,
                      role: "user",
                      content: formRecord(answered, selected, values),
                      createdAt: Date.now(),
                    }]
                    bump()
                  }
                  void control("answer", undefined, { choiceId: answered?.id || "", selected, values })
                }}
              />
              ) : (
              <ExtensionChecklist
                key={pane.choice.id}
                choice={pane.choice}
                onSubmit={(selected, values) => {
                  const answered = pane.choice
                  if (answered) {
                    pane.messages = [...pane.messages, {
                      id: `form-${answered.id}`,
                      role: "user",
                      content: formRecord(answered, selected, values),
                      createdAt: Date.now(),
                    }]
                    bump()
                  }
                  void control("answer", undefined, { choiceId: answered?.id || "", selected, values })
                }}
              />
              )
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                submitDraft()
              }}
            >
              <Textarea
                value={draft}
                onChange={(event) => { visible().draft = event.target.value; bump() }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    submitDraft()
                  }
                }}
                placeholder={
                  !settings?.ready
                    ? "LUXAI is not ready"
                    : busy
                      ? "Steer this answer. Shift+Enter for a new line."
                      : "Ask LUXAI. Enter sends. Shift+Enter for a new line."
                }
                disabled={!settings?.ready}
                rows={3}
              />
              <div className="flex flex-col gap-2">
                <Button type="submit" disabled={!settings?.ready || !draft.trim()}>
                  {busy ? "Steer" : "Send"}
                </Button>
                {busy ? (
                  <Button type="button" variant="outline" disabled={!draft.trim()} onClick={() => void interrupt(draft)}>
                    Interrupt
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ExtensionChecklist({
  choice,
  onSubmit,
  initialValues,
  initialSelected,
  locked = false,
}: {
  choice: LuxaiChoice
  onSubmit: (selected: string[], values: Record<string, string>) => void
  initialValues?: Record<string, string>
  initialSelected?: string[]
  locked?: boolean
}) {
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries((initialSelected ?? []).map((id) => [id, true])))
  const [values, setValues] = useState<Record<string, string>>({ vlan: "10", ...initialValues })
  const [sent, setSent] = useState(locked)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const fields = choice.fields ?? []
  const vmsField = fields.find((field) => field.kind === "vms")
  const templateChoices = (vmsField?.options ?? []).map((option) => ({ id: option.id, os: option.detail || "" }))
  const [networks, setNetworks] = useState<RangeNetworkDraft[]>(() => {
    const saved = initialValues?.networks ? parseRangeNetworks(initialValues.networks) : []
    return saved.length > 0 ? saved : defaultNetworks()
  })
  const [rules, setRules] = useState<RangeRuleDraft[]>(() => initialValues?.rules ? parseRangeRules(initialValues.rules) : [])
  const [vmRows, setVmRows] = useState<RangeVmDraft[]>(() => {
    const saved = initialValues?.vms ? parseRangeVms(initialValues.vms) : []
    return saved.length > 0 ? saved : defaultVmRows(templateChoices)
  })
  const shown = fields.filter((field) => fieldIsVisible(field, fields, values))
  const checks = fields.length > 0
    ? shown.filter((field) => field.kind === "check")
    : []
  return (
    <form
      className="rounded-md border border-border bg-card px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (sent) return
        const selected = checks.flatMap((field) => (field.options ?? []).filter((option) => picked[option.id]).map((option) => option.id))
        const next = { ...values }
        for (const field of shown) {
          if (field.kind === "select" && !next[field.id] && field.options?.[0]) next[field.id] = field.options[0].id
        }
        const errors: Record<string, string> = {}
        if (shown.some((field) => field.id === "rangeId")) {
          const message = validateRangeId(next.rangeId || "")
          if (message) errors.rangeId = message
        }
        if (shown.some((field) => field.id === "name")) {
          const message = validateRangeName(next.name || "")
          if (message) errors.name = message
        }
        if (shown.some((field) => field.id === "networks")) {
          const message = validateNetworks(networks)
          if (message) errors.networks = message
          next.networks = JSON.stringify(networks.map((row) => ({ vlan: row.vlan.trim() })))
        }
        if (shown.some((field) => field.id === "vms")) {
          const machines = validateRangeVms(vmRows, templateChoices, shown.some((field) => field.id === "networks") ? networks : undefined)
          if (machines) errors.vms = machines
          const domain = validateDomain(next.domain || "", vmRows)
          if (domain) errors.domain = domain
          next.vms = JSON.stringify(vmRows.map((row) => ({
            hostname: row.hostname.trim(),
            role: row.role,
            template: row.template,
            vlan: row.vlan.trim(),
            ...(row.domain?.trim() ? { domain: row.domain.trim() } : {}),
            ...(row.domainJoin ? { domainJoin: true } : {}),
          })))
        }
        if (shown.some((field) => field.id === "rules")) {
          const message = validateRules(rules, shown.some((field) => field.id === "networks") ? networks : undefined)
          if (message) errors.rules = message
          next.rules = JSON.stringify(rules.map((row) => ({
            name: row.name.trim(),
            vlanSrc: row.vlanSrc.trim(),
            vlanDst: row.vlanDst.trim(),
            protocol: row.protocol,
            ports: row.protocol === "all" ? "all" : row.ports.trim(),
            action: row.action,
            ...(row.ipLastOctetSrc ? { ipLastOctetSrc: row.ipLastOctetSrc } : {}),
            ...(row.ipLastOctetDst ? { ipLastOctetDst: row.ipLastOctetDst } : {}),
          })))
        }
        if (Object.keys(errors).length > 0) {
          setFieldErrors(errors)
          return
        }
        setSent(true)
        onSubmit(selected, next)
      }}
    >
      <p className="mb-3 text-sm leading-relaxed">{choice.prompt}</p>
      {shown.filter((field) => field.kind !== "check").map((field) => (
        <div key={field.id} className="mb-3">
          <Label className="mb-1.5 block">{field.label}</Label>
          {field.kind === "networks" ? (
            <NetworkRows rows={networks} disabled={sent} onChange={setNetworks} />
          ) : field.kind === "rules" ? (
            <FirewallRules rows={rules} networks={shown.some((item) => item.id === "networks") ? networks : []} disabled={sent} onChange={setRules} />
          ) : field.kind === "vms" ? (
            <VmRows
              rows={vmRows}
              roles={field.roles ?? []}
              templates={templateChoices}
              networks={networks}
              disabled={sent}
              onChange={setVmRows}
            />
          ) : field.kind === "select" ? (
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={values[field.id] || field.options?.[0]?.id || ""}
              disabled={sent}
              onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
            >
              {(field.options ?? []).map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          ) : (
            <Input
              value={field.id === "vlan" ? (values.vlan ?? "10") : (values[field.id] || "")}
              placeholder={field.placeholder}
              disabled={sent}
              onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
            />
          )}
          {fieldErrors[field.id] ? <span className="mt-1 block text-destructive">{fieldErrors[field.id]}</span> : null}
        </div>
      ))}
      {fields.length === 0 ? (
        choice.options.length === 0 ? (
          <p className="mb-2 text-xs text-muted-foreground">Continue when this looks right.</p>
        ) : (
          <div className="mb-2 space-y-2">
            {choice.options.map((option) => (
              <CheckRow key={option.id} option={option} picked={picked} sent={sent} onPick={setPicked} />
            ))}
          </div>
        )
      ) : checks.map((field) => (
        <div key={field.id} className="mb-2 space-y-2">
          <Label className="mb-1.5 block">{field.label}</Label>
          {(field.options ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">None are available.</p>
          ) : (field.options ?? []).map((option) => (
            <CheckRow key={option.id} option={option} picked={picked} sent={sent} onPick={setPicked} />
          ))}
        </div>
      ))}
      {locked ? null : <Button type="submit" size="sm" disabled={sent}>{sent ? "Sending…" : "Continue"}</Button>}
    </form>
  )
}

function fieldValue(fieldId: string, fields: LuxaiChoice["fields"], values: Record<string, string>): string {
  if (values[fieldId]) return values[fieldId]
  const field = (fields ?? []).find((item) => item.id === fieldId)
  if (field?.kind === "select") return field.options?.[0]?.id || ""
  return ""
}

function fieldIsVisible(
  field: NonNullable<LuxaiChoice["fields"]>[number],
  fields: LuxaiChoice["fields"],
  values: Record<string, string>,
): boolean {
  if (field.hideWhen?.length && field.hideWhen.every((rule) => ruleMatches(rule, fields, values))) return false
  if (!field.showWhen?.length) return true
  return field.showWhen.every((rule) => ruleMatches(rule, fields, values))
}

function ruleMatches(
  rule: { field: string; equals?: string; notEquals?: string },
  fields: LuxaiChoice["fields"],
  values: Record<string, string>,
): boolean {
  const current = fieldValue(rule.field, fields, values)
  if (rule.equals != null) return current === rule.equals
  if (rule.notEquals != null) return current !== rule.notEquals
  return true
}

function CheckRow({
  option,
  picked,
  sent,
  onPick,
}: {
  option: { id: string; label: string; detail?: string }
  picked: Record<string, boolean>
  sent: boolean
  onPick: (value: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>)) => void
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox
        checked={picked[option.id] === true}
        disabled={sent}
        onCheckedChange={(value) => onPick((current) => ({ ...current, [option.id]: value === true }))}
      />
      <span>
        <span className="font-medium">{option.label}</span>
        {option.detail ? <span className="block text-xs text-muted-foreground">{option.detail}</span> : null}
      </span>
    </label>
  )
}

function conversationItems(messages: LuxaiMessageView[], changes: LuxaiChangeView[]) {
  const items: Array<{ kind: "message"; message: LuxaiMessageView } | { kind: "change"; change: LuxaiChangeView }> = []
  const rest = [...changes].sort((a, b) => a.createdAt - b.createdAt)
  for (const message of messages) {
    items.push({ kind: "message", message })
    if (message.role !== "assistant") continue
    const due = rest.filter((change) => change.createdAt <= message.createdAt + 1500)
    for (const change of due) {
      items.push({ kind: "change", change })
      rest.splice(rest.indexOf(change), 1)
    }
  }
  for (const change of rest) items.push({ kind: "change", change })
  return items
}

function SessionRow({
  session,
  active,
  seenAt,
  onOpen,
  onArchive,
  archiveLabel = "Archive",
  onRename,
  onDelete,
}: {
  session: LuxaiSessionSummary
  active: boolean
  seenAt: number
  onOpen: () => void
  onArchive: () => void
  archiveLabel?: string
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const skipCommit = useRef(false)
  useEffect(() => {
    if (!editing) setDraft(session.title)
  }, [editing, session.title])

  function commit() {
    if (skipCommit.current) {
      skipCommit.current = false
      return
    }
    const next = draft.trim()
    setEditing(false)
    if (!next || next === session.title) {
      setDraft(session.title)
      return
    }
    onRename(next)
  }

  function startRename() {
    window.setTimeout(() => setEditing(true), 0)
  }

  return (
    <div className={cn("flex items-start gap-1 rounded-md border px-1.5 py-1", active ? "border-primary bg-accent" : "border-border")}>
      {editing ? (
        <Input
          autoFocus
          aria-label="Chat name"
          className="h-8 min-w-0 flex-1 text-sm"
          value={draft}
          maxLength={80}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (event.key === "Escape") {
              skipCommit.current = true
              setDraft(session.title)
              setEditing(false)
            }
          }}
        />
      ) : (
        <button type="button" className="min-w-0 flex-1 rounded px-1 py-1 text-left text-sm hover:bg-accent/60" onClick={onOpen} onDoubleClick={startRename}>
          <span className="flex items-start gap-2">
            <span className="mt-1.5"><SessionMark session={session} active={active} seenAt={seenAt} /></span>
            <span className="line-clamp-2 break-words" title={session.title}>{session.title}</span>
          </span>
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 shrink-0 px-0" aria-label="Chat actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={startRename}>Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>{archiveLabel}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function SessionMark({
  session,
  active,
  seenAt,
}: {
  session: LuxaiSessionSummary
  active: boolean
  seenAt: number
}) {
  if (session.runStatus === "running" || session.runStatus === "paused") {
    return <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" title={session.runStatus === "paused" ? "Paused" : "Working"} />
  }
  if (!active && session.updatedAt > seenAt && (session.runStatus === "done" || session.runStatus === "stopped")) {
    return <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-status-warning" title="Not viewed" />
  }
  return <span className="inline-block h-2 w-2 shrink-0" />
}

function Thinking({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <details className="mb-2 rounded-md bg-black/25 px-2 py-1 text-xs">
      <summary className="cursor-pointer select-none">Thinking</summary>
      <div
        ref={ref}
        className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap opacity-90"
        onScroll={() => {
          const el = ref.current
          if (!el) return
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {text}
      </div>
    </details>
  )
}

function ChatBubble({
  message,
  activity,
  copied,
  onCopy,
}: {
  message: LuxaiMessageView
  activity?: string
  copied: boolean
  onCopy: () => void
}) {
  const saved = parseFormRecord(message.content)
  if (saved) {
    const savedChoice = { id: message.id, prompt: saved.prompt, multiple: true, options: saved.options, fields: saved.fields }
    const Form = isRangeBuildChoice(savedChoice) ? RangeBuildWizard : ExtensionChecklist
    return (
      <Form
        choice={savedChoice}
        initialValues={saved.values}
        initialSelected={saved.selected}
        locked
        onSubmit={() => undefined}
      />
    )
  }
  if (isResumeQuestion(message.content)) {
    return <p className="text-center text-xs text-muted-foreground">Command finished. Continuing the request.</p>
  }
  const mine = message.role === "user"
  return (
    <div className={mine ? "ml-10 flex justify-end" : "mr-10 flex justify-start"}>
      <div className={mine
        ? "max-w-[46rem] rounded-lg bg-primary px-4 py-3 text-primary-foreground shadow-sm"
        : "max-w-[46rem] rounded-lg border border-border bg-card px-4 py-3 text-card-foreground shadow-sm"}
      >
        <div className="mb-2 flex items-center justify-between gap-3 text-xs opacity-80">
          <span>{mine ? "You" : "LUXAI"}</span>
          <button type="button" className="underline-offset-2 hover:underline" onClick={onCopy}>{copied ? "Copied" : "Copy"}</button>
        </div>
        {message.reasoning?.trim() ? <Thinking text={message.reasoning} /> : null}
        {activity && !message.content ? (
          <p className={cn("flex items-center gap-2 text-sm", statusText("info"))}>
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-status-info" />
            {activity}
          </p>
        ) : (
          <Markdown text={message.content || "…"} />
        )}
      </div>
    </div>
  )
}

function ChangeCard({
  change,
  acting,
  note,
  onAct,
}: {
  change: LuxaiChangeView
  acting: boolean
  note: string
  onAct: (id: string, action: "apply" | "revert" | "reject", yaml?: string) => Promise<void>
}) {
  const splitAt = change.preview.indexOf("\n\n--- output ---\n")
  const summary = splitAt === -1 ? change.preview : change.preview.slice(0, splitAt)
  const output = splitAt === -1 ? "" : change.preview.slice(splitAt + "\n\n--- output ---\n".length)
  const failed = change.status === "applied" && guestOutputFailed(output)
  const waiting = acting || change.status === "applying"
  const [yaml, setYaml] = useState(change.yaml || "")
  useEffect(() => {
    setYaml(change.yaml || "")
  }, [change.id, change.yaml])
  const editable = Boolean(change.yaml) && (change.status === "pending" || change.status === "applying")
  const tone: StatusKind = failed ? "error" : waiting ? "info" : change.status === "applied" ? "success" : change.status === "rejected" ? "neutral" : "warning"
  const badge = failed ? "destructive" : waiting ? "info" : change.status === "applied" ? "success" : change.status === "pending" ? "warning" : "outline"
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", statusSurface(tone), "text-foreground")}>
      <div className="mb-1 flex items-center gap-2">
        <Badge variant={badge}>{waiting ? "Applying" : failed ? "Failed" : change.status === "pending" ? "Waiting for Apply" : change.status}</Badge>
        <span className="font-medium">{change.summary}</span>
      </div>
      {change.yaml ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">{change.preview}</p>
          <RangeIdYamlHostnameNote yaml={yaml} />
          <Textarea
            aria-label="Range config"
            className="mt-1 min-h-64 font-mono text-xs"
            value={yaml}
            disabled={!editable}
            onChange={(event) => setYaml(event.target.value)}
          />
        </>
      ) : (
        <div className="mt-1 space-y-2">
          {summary ? <p className="whitespace-pre-wrap text-xs text-muted-foreground">{summary}</p> : null}
          {output ? (
            <div className="max-h-[32rem] overflow-auto rounded-md border border-white/10 p-2">
              <Markdown text={output} />
            </div>
          ) : null}
        </div>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {change.rangeId} · {change.kind}
        {change.revertable ? " · previous state kept" : " · not automatically reversible"}
      </p>
      {waiting ? <p className="mt-1 text-xs text-muted-foreground">{note || "Sending this to the host. The buttons wait until it answers."}</p> : null}
      {!waiting && change.status === "pending" && note ? <p className="mt-1 text-xs text-destructive">{note}</p> : null}
      {failed ? <p className="mt-1 text-xs text-destructive">The command ran and failed. This card will not run it again.</p> : null}
      {change.status === "pending" || change.status === "applying" ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={waiting || (Boolean(change.yaml) && !yaml.trim())} onClick={() => void onAct(change.id, "apply", change.yaml ? yaml : undefined)}>{waiting ? "Applying…" : "Apply"}</Button>
          <Button size="sm" variant="outline" disabled={waiting} onClick={() => void onAct(change.id, "reject")}>Reject</Button>
        </div>
      ) : null}
      {change.status === "applied" && change.revertable ? (
        <Button className="mt-2" size="sm" variant="outline" disabled={acting} onClick={() => void onAct(change.id, "revert")}>{acting ? "Reverting…" : "Revert"}</Button>
      ) : null}
    </div>
  )
}

const fieldClass = "mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

interface ProviderDraft {
  egress: "local" | "cloud"
  baseUrl: string
  model: string
  effort: string
  contextWindow: number
  catalog: LuxaiModelInfo[]
  modelParams: Record<string, string>
  apiKey: string
  apiKeySet: boolean
}

function providerDraft(profile: LuxaiProviderPublic, id: LuxaiProvider): ProviderDraft {
  return {
    egress: id === "cursor" ? "cloud" : profile.egress,
    baseUrl: id === "cursor" ? "https://api.cursor.com" : profile.baseUrl,
    model: profile.model,
    effort: profile.effort,
    contextWindow: profile.contextWindow,
    catalog: profile.catalog,
    modelParams: Object.fromEntries(profile.modelParams.map((item) => [item.id, item.value])),
    apiKey: "",
    apiKeySet: profile.apiKeySet,
  }
}

function providerDrafts(settings: LuxaiPublicSettings): Record<LuxaiProvider, ProviderDraft> {
  return {
    openai: providerDraft(settings.profiles.openai, "openai"),
    anthropic: providerDraft(settings.profiles.anthropic, "anthropic"),
    cursor: providerDraft(settings.profiles.cursor, "cursor"),
  }
}

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: LuxaiPublicSettings
  onSaved: () => Promise<void>
}) {
  const [enabled, setEnabled] = useState(settings.enabled)
  const [provider, setProvider] = useState<LuxaiProvider>(settings.provider)
  const [drafts, setDrafts] = useState(() => providerDrafts(settings))
  const [notice, setNotice] = useState("")
  const draft = drafts[provider]
  const { egress, baseUrl, model, effort, contextWindow, catalog, modelParams, apiKey } = draft
  const savedProfile = settings.profiles[provider]
  const keyKept = draft.apiKeySet && (provider === "cursor" || (baseUrl.trim() === savedProfile.baseUrl && egress === savedProfile.egress))

  function updateDraft(partial: Partial<ProviderDraft>) {
    setDrafts((current) => ({ ...current, [provider]: { ...current[provider], ...partial } }))
  }

  useEffect(() => {
    setEnabled(settings.enabled)
    setDrafts((current) => {
      const next = providerDrafts(settings)
      for (const id of ["openai", "anthropic", "cursor"] as const) {
        const typed = current[id]?.apiKey ?? ""
        if (typed.trim()) next[id] = { ...next[id], apiKey: typed }
      }
      return next
    })
  }, [settings])

  const selected = catalog.find((item) => item.id === model)
  const extraParameters = (selected?.parameters ?? []).filter((param) => !/effort|reasoning|context/i.test(param.id))
  const modelChoices = !model || catalog.some((item) => item.id === model)
    ? catalog
    : [{ id: model, displayName: model, parameters: [] }, ...catalog]

  function body(extra?: Record<string, unknown>) {
    return {
      enabled,
      provider,
      egress: provider === "cursor" ? "cloud" : egress,
      baseUrl: provider === "cursor" ? "https://api.cursor.com" : baseUrl,
      model,
      effort,
      contextWindow,
      modelParams: Object.entries(modelParams)
        .filter(([, value]) => value)
        .map(([id, value]) => ({ id, value })),
      catalog,
      apiKey,
      ...extra,
    }
  }

  async function save(extra?: Record<string, unknown>) {
    setNotice("")
    const response = await luxaiFetch("/api/luxai/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body(extra)),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) {
      setNotice(payload.error || `HTTP ${response.status}`)
      return
    }
    updateDraft({ apiKey: "" })
    setNotice("Saved.")
    await onSaved()
  }

  async function testConnection() {
    setNotice("Connecting…")
    const response = await luxaiFetch("/api/luxai/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, egress, baseUrl, apiKey }),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string; catalog?: LuxaiModelInfo[] }
    if (!response.ok) {
      setNotice(payload.error || `HTTP ${response.status}`)
      return
    }
    const next = payload.catalog ?? []
    updateDraft({
      catalog: next,
      ...(next.length > 0 && !next.some((item) => item.id === model) ? { model: next[0].id } : {}),
    })
    setNotice(next.length > 0 ? `Connected. ${next.length} models loaded. Save to keep this connection.` : "Connected. Save to keep this connection.")
  }

  return (
    <div className="grid max-h-[70vh] gap-3 overflow-auto pr-1 md:grid-cols-2">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} />
        Enable LUXAI
      </label>
      <p className="text-xs text-muted-foreground md:col-span-2">
        Local mode accepts http or https on a private, loopback, or link-local address. Use it for Ollama
        (`http://127.0.0.1:11434/v1`) or llama.cpp. Cloud mode requires https. Claude uses provider Anthropic and
        base URL `https://api.anthropic.com`. Cursor uses a key from the Cursor dashboard and lists models from
        `https://api.cursor.com`. Test connection fills the model list. Effort is sent when that provider accepts
        it. The context window is how much of this chat LUXAI sends. Each provider keeps its own key. Switching providers restores that key. Changing the address for one provider clears only that key.
        {keyKept ? " A key is already saved for this provider." : ""}
      </p>
      <div>
        <Label>Provider</Label>
        <select
          className={fieldClass}
          value={provider}
          onChange={(event) => setProvider(event.target.value as LuxaiProvider)}
        >
          <option value="openai">OpenAI-compatible</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="cursor">Cursor</option>
        </select>
      </div>
      <div>
        <Label>Egress</Label>
        <select className={fieldClass} value={provider === "cursor" ? "cloud" : egress} disabled={provider === "cursor"} onChange={(event) => updateDraft({ egress: event.target.value as "local" | "cloud" })}>
          <option value="local">Local network only</option>
          <option value="cloud">Cloud (https)</option>
        </select>
      </div>
      <div>
        <Label>Base URL</Label>
        <Input value={provider === "cursor" ? "https://api.cursor.com" : baseUrl} readOnly={provider === "cursor"} onChange={(event) => updateDraft({ baseUrl: event.target.value, catalog: [] })} placeholder="https://api.anthropic.com" />
      </div>
      <div>
        <Label>Model</Label>
        {catalog.length > 0 ? (
          <select className={fieldClass} value={model} onChange={(event) => updateDraft({ model: event.target.value })}>
            {modelChoices.map((item) => (
              <option key={item.id} value={item.id}>{item.displayName === item.id ? item.id : `${item.displayName} (${item.id})`}</option>
            ))}
          </select>
        ) : (
          <Input value={model} onChange={(event) => updateDraft({ model: event.target.value })} placeholder="Test connection to load models" />
        )}
      </div>
      {provider === "cursor" && /auto/i.test(selected?.displayName || model) ? (
        <p className="text-xs text-muted-foreground md:col-span-2">
          Auto on Default, Grok, and Composer use the included pool. LUX runs them as a local agent on this server, with no tools, so the Cloud Agents API is not used and a prepaid balance is not required. Balance or Intelligence can spend prepaid credit.
        </p>
      ) : null}
      <div>
        <Label>Effort</Label>
        <select className={fieldClass} value={effort} onChange={(event) => updateDraft({ effort: event.target.value })}>
          <option value="">Default</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Extra high</option>
        </select>
      </div>
      <div>
        <Label>Context window</Label>
        <select className={fieldClass} value={String(contextWindow)} onChange={(event) => updateDraft({ contextWindow: Number(event.target.value) })}>
          <option value="0">Default</option>
          <option value="32000">32k</option>
          <option value="128000">128k</option>
          <option value="200000">200k</option>
          <option value="256000">256k</option>
          <option value="500000">500k</option>
          <option value="1000000">1M</option>
        </select>
      </div>
      {extraParameters.map((param) => (
        <div key={param.id}>
          <Label>{param.displayName || param.id}</Label>
          <select
            className={fieldClass}
            value={modelParams[param.id] || ""}
            onChange={(event) => updateDraft({ modelParams: { ...modelParams, [param.id]: event.target.value } })}
          >
            <option value="">Default</option>
            {param.values.map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.displayName || choice.value}</option>
            ))}
          </select>
        </div>
      ))}
      <div className="md:col-span-2">
        <Label>API key</Label>
        <Input type="password" value={apiKey} onChange={(event) => updateDraft({ apiKey: event.target.value })} placeholder={keyKept ? "Saved key kept if this stays blank" : provider === "cursor" ? "Cursor API key" : "Optional for most local servers"} autoComplete="off" />
      </div>
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <Button type="button" size="sm" onClick={() => void save()}>Save</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void testConnection()}>Test connection</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void save({ clearKey: true, apiKey: "" })}>Remove saved key</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void save({ resetPrompt: true })}>Reset prompt</Button>
      </div>
      {notice ? <p className="text-sm md:col-span-2">{notice}</p> : null}
    </div>
  )
}
