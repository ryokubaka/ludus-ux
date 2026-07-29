"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Bot, Send, Settings, ShieldAlert, HelpCircle, Plus, Trash2, Square, Pencil, Copy, Check } from "lucide-react"
import { useRange } from "@/lib/range-context"
import { queryKeys } from "@/lib/query-keys"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { STALE } from "@/lib/query-client"
import { cn } from "@/lib/utils"
import { prettyToolChatDetail } from "@/lib/assistant/redact-secrets"
import { formatAssistantSessionForCopy } from "@/lib/assistant/session-copy"
import type { AskAnswers, AskQuestion } from "@/lib/assistant/ask-user"

type ChatRow =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | {
      kind: "confirm"
      token: string
      summary: string
      detail?: string
      resolved?: "allowed" | "denied" | "superseded"
    }
  | {
      kind: "ask"
      token: string
      title: string
      message?: string
      questions: AskQuestion[]
      resolved?: "answered" | "cancelled" | "superseded"
      answers?: AskAnswers
    }
  | { kind: "status"; text: string }
  | { kind: "thinking"; text: string }

type ConversationMeta = {
  id: string
  title: string
  status: "idle" | "running" | "interrupted" | "cancelled"
  updatedAt: number
  preview: string
  activeRunId?: string | null
}

/** Collapsible pretty tool payload — toggle sits after the text. */
function ToolDetailBlock({ name, detail }: { name: string; detail: string }) {
  const [expanded, setExpanded] = useState(false)
  const pretty = prettyToolChatDetail(detail)
  const PREVIEW_LINES = 3
  const lines = pretty.split("\n")
  const long = lines.length > PREVIEW_LINES
  const body =
    long && !expanded ? `${lines.slice(0, PREVIEW_LINES).join("\n")}\n…` : pretty

  return (
    <div className="text-[11px] font-mono text-muted-foreground border-l-2 border-border pl-2">
      <Badge variant="outline" className="text-[10px] mr-1 align-middle">
        {name}
      </Badge>
      <pre
        className={cn(
          "mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug",
          long && expanded && "max-h-[28rem] overflow-auto rounded border border-border/50 bg-muted/20 p-2",
        )}
      >
        {body}
      </pre>
      {long ? (
        <button
          type="button"
          className="mt-0.5 text-[10px] text-primary underline underline-offset-2"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "show less" : "show more"}
        </button>
      ) : null}
    </div>
  )
}

/** Interactive ask_user card — button choices + optional text. */
function AskPromptBlock({
  title,
  message,
  questions,
  token,
  active,
  resolved,
  answers: savedAnswers,
  busy,
  onSubmit,
  onCancel,
}: {
  title: string
  message?: string
  questions: AskQuestion[]
  token: string
  active: boolean
  resolved?: "answered" | "cancelled" | "superseded"
  answers?: AskAnswers
  busy: boolean
  onSubmit: (token: string, answers: AskAnswers) => void
  onCancel: (token: string) => void
}) {
  const [draft, setDraft] = useState<AskAnswers>(() => {
    const init: AskAnswers = {}
    for (const q of questions) init[q.id] = { selected: [], text: "" }
    return init
  })

  const toggle = (qid: string, optId: string, multi: boolean) => {
    setDraft((prev) => {
      const cur = prev[qid]?.selected || []
      let next: string[]
      if (multi) {
        next = cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId]
      } else {
        next = cur.includes(optId) ? [] : [optId]
      }
      return { ...prev, [qid]: { ...prev[qid], selected: next } }
    })
  }

  const setText = (qid: string, text: string) => {
    setDraft((prev) => ({ ...prev, [qid]: { ...prev[qid], text } }))
  }

  const displayAnswers = resolved === "answered" ? savedAnswers : draft

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs space-y-3">
      <p className="flex items-center gap-1.5 font-medium">
        <HelpCircle className="h-3.5 w-3.5" />
        {title}
      </p>
      {message ? <p className="text-muted-foreground whitespace-pre-wrap">{message}</p> : null}
      {questions.map((q) => {
        const a = displayAnswers?.[q.id]
        return (
          <div key={q.id} className="space-y-1.5">
            <p className="font-medium text-[11px]">
              {q.prompt}
              {q.required !== false ? <span className="text-destructive"> *</span> : null}
            </p>
            {q.type !== "text" && q.options ? (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const selected = !!a?.selected?.includes(opt.id)
                  return (
                    <Button
                      key={opt.id}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      disabled={!active || busy || !!resolved}
                      onClick={() => toggle(q.id, opt.id, q.type === "multi")}
                    >
                      {opt.label}
                    </Button>
                  )
                })}
              </div>
            ) : null}
            {(q.type === "text" || q.allowCustom) && (active || a?.text) ? (
              <Input
                className="h-8 text-xs"
                placeholder={q.type === "text" ? "Your answer…" : "Other / custom…"}
                value={a?.text || ""}
                disabled={!active || busy || !!resolved}
                onChange={(e) => setText(q.id, e.target.value)}
              />
            ) : null}
            {resolved === "answered" && a ? (
              <p className="text-[11px] text-muted-foreground">
                {[
                  a.selected?.length
                    ? a.selected
                        .map((id) => q.options?.find((o) => o.id === id)?.label || id)
                        .join(", ")
                    : null,
                  a.text ? `custom: ${a.text}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "(empty)"}
              </p>
            ) : null}
          </div>
        )
      })}
      {resolved ? (
        <p className="text-[11px] text-muted-foreground">
          {resolved === "answered"
            ? "Answered"
            : resolved === "cancelled"
              ? "Cancelled"
              : "Superseded by a newer prompt"}
        </p>
      ) : active ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => onSubmit(token, draft)}>
            Submit
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onCancel(token)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Waiting…</p>
      )}
    </div>
  )
}

/** ~10 SelectItem rows (py-1.5 text-xs) before scrolling. */
const SESSION_DROPDOWN_MAX_H = "max-h-[20rem]"

/** Turn `/templates`-style paths into in-app links inside assistant bubbles. */
function linkifyAppPaths(text: string): ReactNode[] {
  const re = /(\/(?:templates|range|goad|sources|settings|assistant|logs)(?:\/[\w.-]*)*)/g
  const parts: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const href = m[1]
    parts.push(
      <Link key={`p-${key++}`} href={href} className="text-primary underline underline-offset-2 font-medium">
        {href}
      </Link>,
    )
    last = m.index + href.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : [text]
}

function activeKeyForOwner(owner: string): string {
  return `lux-assistant-active-conversation-id:${owner}`
}

async function apiList(): Promise<{ owner: string; conversations: ConversationMeta[] }> {
  const res = await fetch("/api/assistant/conversations")
  if (!res.ok) throw new Error("list conversations failed")
  const data = (await res.json()) as { owner?: string; conversations: ConversationMeta[] }
  return { owner: data.owner || "", conversations: data.conversations || [] }
}

async function apiCreate(): Promise<{
  id: string
  rows: ChatRow[]
  pendingConfirm: { token: string; summary: string; detail?: string } | null
  status: ConversationMeta["status"]
  activeRunId?: string | null
  title?: string
}> {
  const res = await fetch("/api/assistant/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [] }),
  })
  if (!res.ok) throw new Error("create conversation failed")
  return res.json()
}

async function apiGet(id: string) {
  const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error("load conversation failed")
  return res.json() as Promise<{
    id: string
    rows: ChatRow[]
    pendingConfirm: { token: string; summary: string; detail?: string } | null
    status: ConversationMeta["status"]
    activeRunId: string | null
    title?: string
  }>
}

async function apiRename(id: string, title: string) {
  const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, titleLocked: true }),
  })
  if (!res.ok) throw new Error("rename failed")
  return res.json() as Promise<{ id: string; title: string }>
}

async function apiDelete(id: string) {
  const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  if (!res.ok) throw new Error("delete conversation failed")
}

async function followRun(
  conversationId: string,
  signal: AbortSignal,
  onUpdate: (data: Awaited<ReturnType<typeof apiGet>>) => void,
): Promise<void> {
  while (!signal.aborted) {
    const loaded = await apiGet(conversationId)
    onUpdate(loaded)
    if (loaded.status !== "running") return
    await new Promise((r) => setTimeout(r, 450))
  }
}

export function AssistantPageClient() {
  const { selectedRangeId } = useRange()
  const scopeTag = useEffectiveScopeTag()
  const [input, setInput] = useState("")
  const [rows, setRows] = useState<ChatRow[]>([])
  const [busy, setBusy] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<{
    token: string
    summary: string
    detail?: string
  } | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ConversationMeta[]>([])
  const [owner, setOwner] = useState("")
  const [sessionTitle, setSessionTitle] = useState("Conversation")
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState("")
  const [hydrating, setHydrating] = useState(true)
  const [copiedSession, setCopiedSession] = useState(false)
  const followAbortRef = useRef<AbortController | null>(null)
  const conversationIdRef = useRef(conversationId)
  const ownerRef = useRef(owner)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  conversationIdRef.current = conversationId
  ownerRef.current = owner

  // Keep the chat pane pinned to the latest message while the user is at/near the bottom.
  useEffect(() => {
    const el = chatScrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [rows, hydrating, busy])

  const { data: settings, refetch: refetchSettings } = useQuery({
    queryKey: queryKeys.version(scopeTag).concat(["assistant-settings"]),
    queryFn: async () => {
      const res = await fetch("/api/settings", { cache: "no-store" })
      if (!res.ok) throw new Error("settings")
      return res.json() as Promise<{
        aiAssistantEnabled?: boolean
        llmBaseUrl?: string
        llmModel?: string
      }>
    },
    staleTime: STALE.short,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    const onSettings = () => {
      void refetchSettings()
    }
    window.addEventListener("lux-settings-updated", onSettings)
    return () => window.removeEventListener("lux-settings-updated", onSettings)
  }, [refetchSettings])

  const enabled = !!settings?.aiAssistantEnabled && !!settings?.llmBaseUrl?.trim()
  const modelLabel = (settings?.llmModel || "").trim() || "(model not set)"
  const llmHost = (() => {
    const raw = (settings?.llmBaseUrl || "").trim()
    if (!raw) return ""
    try {
      return new URL(raw).host
    } catch {
      return raw.replace(/^https?:\/\//, "").split("/")[0] || raw
    }
  })()

  const refreshSessions = useCallback(async () => {
    try {
      const data = await apiList()
      setOwner(data.owner)
      setSessions(data.conversations)
    } catch {
      /* ignore */
    }
  }, [])

  const stopFollow = useCallback(() => {
    followAbortRef.current?.abort()
    followAbortRef.current = null
  }, [])

  const applyLoaded = useCallback((loaded: Awaited<ReturnType<typeof apiGet>>) => {
    setRows(loaded.rows || [])
    setPendingConfirm(loaded.pendingConfirm)
    setBusy(loaded.status === "running")
    setRunId(loaded.activeRunId)
    if (loaded.title) setSessionTitle(loaded.title)
  }, [])

  const persistActive = useCallback((id: string, ownerName: string) => {
    if (!ownerName) return
    localStorage.setItem(activeKeyForOwner(ownerName), id)
  }, [])

  const startFollow = useCallback(
    (id: string) => {
      stopFollow()
      const ac = new AbortController()
      followAbortRef.current = ac
      setBusy(true)
      void followRun(id, ac.signal, (loaded) => {
        if (conversationIdRef.current !== id) return
        applyLoaded(loaded)
        if (loaded.status !== "running") void refreshSessions()
      }).catch(() => {
        if (!ac.signal.aborted) setBusy(false)
      })
    },
    [applyLoaded, refreshSessions, stopFollow],
  )

  // Reload on enable + effective user scope (self vs impersonation).
  useEffect(() => {
    if (!enabled) {
      setHydrating(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setHydrating(true)
      stopFollow()
      setConversationId(null)
      setRows([])
      setPendingConfirm(null)
      setBusy(false)
      setRunId(null)
      setRenaming(false)
      try {
        const data = await apiList()
        if (cancelled) return
        setOwner(data.owner)
        setSessions(data.conversations)
        const preferred =
          (data.owner ? localStorage.getItem(activeKeyForOwner(data.owner)) : null) ||
          data.conversations[0]?.id ||
          null
        if (!preferred) {
          const created = await apiCreate()
          if (cancelled) return
          setConversationId(created.id)
          setSessionTitle(created.title || "Conversation")
          setRows([])
          persistActive(created.id, data.owner)
          const again = await apiList()
          setSessions(again.conversations)
          return
        }
        let loaded: Awaited<ReturnType<typeof apiGet>>
        try {
          loaded = await apiGet(preferred)
        } catch {
          const created = await apiCreate()
          loaded = { ...created, pendingConfirm: null, activeRunId: null, title: created.title }
        }
        if (cancelled) return
        setConversationId(loaded.id)
        applyLoaded(loaded)
        persistActive(loaded.id, data.owner)
        if (loaded.status === "running") startFollow(loaded.id)
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setHydrating(false)
      }
    })()
    return () => {
      cancelled = true
      stopFollow()
    }
  }, [enabled, scopeTag, applyLoaded, startFollow, stopFollow, persistActive])

  const openConversation = async (id: string) => {
    if (id === conversationId) return
    stopFollow()
    setHydrating(true)
    setRenaming(false)
    stickToBottomRef.current = true
    try {
      const loaded = await apiGet(id)
      setConversationId(loaded.id)
      applyLoaded(loaded)
      persistActive(loaded.id, ownerRef.current)
      if (loaded.status === "running") startFollow(loaded.id)
    } finally {
      setHydrating(false)
    }
  }

  const newConversation = async () => {
    stopFollow()
    setRenaming(false)
    stickToBottomRef.current = true
    const created = await apiCreate()
    setConversationId(created.id)
    setSessionTitle(created.title || "Conversation")
    setRows([])
    setPendingConfirm(null)
    setInput("")
    setBusy(false)
    setRunId(null)
    persistActive(created.id, ownerRef.current)
    await refreshSessions()
  }

  const commitRename = async () => {
    if (!conversationId) return
    const next = renameDraft.trim().slice(0, 120)
    if (!next) {
      setRenaming(false)
      return
    }
    try {
      const updated = await apiRename(conversationId, next)
      setSessionTitle(updated.title)
      await refreshSessions()
    } catch {
      /* ignore */
    } finally {
      setRenaming(false)
    }
  }

  const deleteCurrent = async () => {
    if (!conversationId) return
    stopFollow()
    setRenaming(false)
    await apiDelete(conversationId)
    const data = await apiList()
    setOwner(data.owner)
    setSessions(data.conversations)
    if (data.conversations[0]) {
      await openConversation(data.conversations[0].id)
    } else {
      const created = await apiCreate()
      setConversationId(created.id)
      setSessionTitle(created.title || "Conversation")
      setRows([])
      setPendingConfirm(null)
      setBusy(false)
      setRunId(null)
      persistActive(created.id, data.owner)
      await refreshSessions()
    }
  }

  const cancelRun = async () => {
    if (!conversationId) return
    await fetch(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/cancel`, {
      method: "POST",
    })
  }

  const runChat = async (userText: string) => {
    let id = conversationId
    if (!id) {
      const created = await apiCreate()
      id = created.id
      setConversationId(id)
      setSessionTitle(created.title || "Conversation")
      persistActive(id, ownerRef.current)
    }

    setRows((prev) => [...prev, { kind: "user", text: userText }])
    setPendingConfirm(null)
    setBusy(true)
    stickToBottomRef.current = true

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: id,
          userText,
          selectedRangeId,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setRows((prev) => [
          ...prev,
          { kind: "assistant", text: err.error || `Request failed (${res.status})` },
        ])
        setBusy(false)
        return
      }
      const data = (await res.json()) as { runId: string; conversationId: string }
      setRunId(data.runId)
      const loaded = await apiGet(data.conversationId)
      applyLoaded(loaded)
      startFollow(data.conversationId)
      void refreshSessions()
    } catch (err) {
      setRows((prev) => [...prev, { kind: "assistant", text: (err as Error).message }])
      setBusy(false)
    }
  }

  const resolveConfirm = async (
    token: string,
    mode: "once" | "allow_op" | "allow_all" | "deny",
  ) => {
    if (!conversationId) return
    setBusy(true)
    stickToBottomRef.current = true
    try {
      const res = await fetch("/api/assistant/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          confirmToken: token,
          mode,
          selectedRangeId,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        runId?: string | null
        conversationId?: string
        denied?: boolean
      }
      if (!res.ok) {
        setRows((prev) => [
          ...prev,
          { kind: "assistant", text: data.error || `Confirm failed (${res.status})` },
        ])
        setBusy(false)
        return
      }
      const loaded = await apiGet(conversationId)
      applyLoaded(loaded)
      if (data.runId) {
        setRunId(data.runId)
        startFollow(conversationId)
      } else {
        setBusy(false)
      }
      void refreshSessions()
    } catch (err) {
      setRows((prev) => [...prev, { kind: "assistant", text: (err as Error).message }])
      setBusy(false)
    }
  }

  const resolveAsk = async (token: string, answers?: AskAnswers, cancelled?: boolean) => {
    if (!conversationId) return
    setBusy(true)
    stickToBottomRef.current = true
    try {
      const res = await fetch("/api/assistant/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          askToken: token,
          answers,
          cancelled: !!cancelled,
          selectedRangeId,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        runId?: string | null
        cancelled?: boolean
      }
      if (!res.ok) {
        setRows((prev) => [
          ...prev,
          { kind: "assistant", text: data.error || `Answer failed (${res.status})` },
        ])
        setBusy(false)
        return
      }
      const loaded = await apiGet(conversationId)
      applyLoaded(loaded)
      if (data.runId) {
        setRunId(data.runId)
        startFollow(conversationId)
      } else {
        setBusy(false)
      }
      void refreshSessions()
    } catch (err) {
      setRows((prev) => [...prev, { kind: "assistant", text: (err as Error).message }])
      setBusy(false)
    }
  }

  if (!enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-12 gap-3 text-center">
          <Bot className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">AI Assistant is not enabled</p>
          <p className="text-xs text-muted-foreground max-w-md">
            Beta feature. An admin must configure an OpenAI-compatible LLM (or Ollama) under Settings → AI,
            then enable the assistant. Report bugs on{" "}
            <a
              href="https://github.com/ryokubaka/ludus-ux/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              GitHub Issues
            </a>
            .
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href="/settings?tab=ai">
              <Settings className="h-3.5 w-3.5" />
              Open AI settings
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)] min-h-[420px]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Assistant
            <Badge variant="warning" className="text-[10px] uppercase tracking-wide font-semibold">
              Beta
            </Badge>
          </h1>
          <p className="text-xs text-muted-foreground">
            Model <code className="text-primary">{modelLabel}</code>
            {llmHost ? (
              <>
                {" "}
                · <code className="text-muted-foreground">{llmHost}</code>
              </>
            ) : null}
            {selectedRangeId ? (
              <>
                {" "}
                · range <code className="text-primary">{selectedRangeId}</code>
              </>
            ) : null}
            {owner ? (
              <>
                {" "}
                · sessions for <code className="text-primary">{owner}</code>
              </>
            ) : null}
            {busy ? (
              <>
                {" "}
                · <span className="text-status-success">running in background</span>
              </>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Beta — verify deploys and tool results. Report bugs on{" "}
            <a
              href="https://github.com/ryokubaka/ludus-ux/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              GitHub Issues
            </a>
            {" "}
            (use <span className="font-medium text-foreground">Copy session</span> when helpful).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {renaming ? (
            <Input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              className="h-8 w-[220px] text-xs"
              autoFocus
              maxLength={120}
              placeholder="Session name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void commitRename()
                }
                if (e.key === "Escape") setRenaming(false)
              }}
              onBlur={() => void commitRename()}
            />
          ) : (
            <Select
              value={conversationId || undefined}
              onValueChange={(v) => void openConversation(v)}
              disabled={hydrating}
            >
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue placeholder={hydrating ? "Loading…" : "Conversation"} />
              </SelectTrigger>
              <SelectContent position="item-aligned" className={cn(SESSION_DROPDOWN_MAX_H, "overflow-y-auto")}>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.status === "running" ? "● " : s.status === "interrupted" ? "⚠ " : ""}
                    {s.title || s.preview || "Conversation"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={hydrating || !conversationId || renaming}
            title="Rename session"
            onClick={() => {
              setRenameDraft(sessionTitle || "Conversation")
              setRenaming(true)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={hydrating || rows.length === 0}
            title="Copy session contents to clipboard"
            onClick={() => {
              const text = formatAssistantSessionForCopy({
                title: sessionTitle,
                conversationId: conversationId || undefined,
                rows,
              })
              void navigator.clipboard.writeText(text).then(
                () => {
                  setCopiedSession(true)
                  window.setTimeout(() => setCopiedSession(false), 2000)
                },
                () => {
                  /* ignore */
                },
              )
            }}
          >
            {copiedSession ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedSession ? "Copied" : "Copy"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void newConversation()} disabled={hydrating}>
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
          {busy ? (
            <Button type="button" size="sm" variant="destructive" onClick={() => void cancelRun()}>
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void deleteCurrent()}
            disabled={hydrating || !conversationId}
            title="Delete conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/settings?tab=ai">AI settings</Link>
          </Button>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium">
            {sessionTitle || "Conversation"}
            {busy ? (
              <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                running{runId ? ` · ${runId.slice(0, 10)}…` : ""}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto space-y-3 min-h-0"
          onScroll={() => {
            const el = chatScrollRef.current
            if (!el) return
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
            stickToBottomRef.current = distanceFromBottom < 80
          }}
        >
          {hydrating && rows.length === 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Restoring history…
            </p>
          )}
          {!hydrating && rows.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Ask about range config, deploys, GOAD, or templates. Runs continue in the background if you refresh or
              navigate away. Use Stop to cancel, or send another message to override.
            </p>
          )}
          {rows.map((r, i) => {
            if (r.kind === "status") {
              return (
                <div key={i} className="text-[11px] text-muted-foreground italic">
                  {r.text}
                </div>
              )
            }
            if (r.kind === "thinking") {
              return (
                <div
                  key={i}
                  className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap mr-8"
                >
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80 mb-1">Thinking</p>
                  {r.text}
                </div>
              )
            }
            if (r.kind === "tool") {
              return <ToolDetailBlock key={i} name={r.name} detail={r.detail} />
            }
            if (r.kind === "confirm") {
              const active = !r.resolved && pendingConfirm?.token === r.token
              return (
                <div
                  key={i}
                  className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs space-y-2"
                >
                  <p className="flex items-center gap-1.5 font-medium">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Confirm: {r.summary}
                  </p>
                  {r.detail ? (
                    <pre className="whitespace-pre-wrap break-words rounded border border-status-warning/30 bg-background/50 px-2 py-1.5 font-mono text-[11px] text-foreground/90 leading-snug">
                      {r.detail}
                    </pre>
                  ) : null}
                  {r.resolved ? (
                    <p className="text-[11px] text-muted-foreground">
                      {r.resolved === "allowed"
                        ? "Approved"
                        : r.resolved === "denied"
                          ? "Denied"
                          : "Superseded by a newer confirmation"}
                    </p>
                  ) : active ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void resolveConfirm(r.token, "once")}
                      >
                        Allow once
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void resolveConfirm(r.token, "allow_op")}
                      >
                        Always allow this
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void resolveConfirm(r.token, "allow_all")}
                      >
                        Allow all this chat
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void resolveConfirm(r.token, "deny")}
                      >
                        Deny
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Waiting…</p>
                  )}
                </div>
              )
            }
            if (r.kind === "ask") {
              const pendingAskToken = [...rows]
                .reverse()
                .find((x): x is Extract<ChatRow, { kind: "ask" }> => x.kind === "ask" && !x.resolved)
                ?.token
              const active = !r.resolved && pendingAskToken === r.token
              return (
                <AskPromptBlock
                  key={i}
                  title={r.title}
                  message={r.message}
                  questions={r.questions || []}
                  token={r.token}
                  active={active}
                  resolved={r.resolved}
                  answers={r.answers}
                  busy={busy}
                  onSubmit={(tok, answers) => void resolveAsk(tok, answers)}
                  onCancel={(tok) => void resolveAsk(tok, undefined, true)}
                />
              )
            }
            return (
              <div
                key={i}
                className={cn(
                  "rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
                  r.kind === "user" ? "bg-primary/10 ml-8" : "bg-muted/40 mr-8",
                )}
              >
                {r.kind === "assistant" ? linkifyAppPaths(r.text) : r.text}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <form
        className="flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const t = input.trim()
          if (!t || hydrating) return
          setInput("")
          void runChat(t)
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? "Send to override the running task…" : "Ask the assistant…"}
          className="min-h-[60px] text-sm"
          disabled={hydrating}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              const t = input.trim()
              if (!t || hydrating) return
              setInput("")
              void runChat(t)
            }
          }}
        />
        <Button type="submit" disabled={hydrating || !input.trim()} className="shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  )
}
