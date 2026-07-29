/**
 * Persist in-app Assistant chat sessions (per Ludus username) in SQLite.
 */

import { getDb } from "@/lib/db"
import {
  emptyConfirmPolicy,
  parseConfirmPolicy,
  type AssistantConfirmPolicy,
} from "@/lib/assistant/confirm-policy"
import type { AskAnswers, AskQuestion } from "@/lib/assistant/ask-user"

export type AssistantChatRow =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | {
      kind: "confirm"
      token: string
      summary: string
      /** Request body / query preview for the user. */
      detail?: string
      /** When set, buttons are hidden — user already acted or a newer prompt superseded this. */
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

export type AssistantConversationStatus = "idle" | "running" | "interrupted" | "cancelled"

export interface AssistantConversationMeta {
  id: string
  username: string
  title: string
  titleLocked: boolean
  status: AssistantConversationStatus
  activeRunId: string | null
  createdAt: number
  updatedAt: number
  preview: string
}

export interface AssistantConversation extends AssistantConversationMeta {
  rows: AssistantChatRow[]
  pendingConfirm: { token: string; summary: string; detail?: string } | null
  /** Active interactive ask card (derived from rows if not stored separately). */
  pendingAsk: {
    token: string
    title: string
    message?: string
    questions: AskQuestion[]
  } | null
  confirmPolicy: AssistantConfirmPolicy
}

function newId(): string {
  return `ac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function previewFromRows(rows: AssistantChatRow[]): string {
  const user = [...rows].reverse().find((r) => r.kind === "user")
  if (user && user.kind === "user") return user.text.slice(0, 80)
  const asst = [...rows].reverse().find((r) => r.kind === "assistant")
  if (asst && asst.kind === "assistant") return asst.text.slice(0, 80)
  return "New conversation"
}

function titleFromRows(rows: AssistantChatRow[]): string {
  const user = rows.find((r) => r.kind === "user")
  if (user && user.kind === "user") {
    const t = user.text.trim().replace(/\s+/g, " ")
    return (t.length > 48 ? `${t.slice(0, 45)}…` : t) || "Conversation"
  }
  return "Conversation"
}

function parseRows(raw: string): AssistantChatRow[] {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v as AssistantChatRow[]) : []
  } catch {
    return []
  }
}

function parsePending(raw: string | null): { token: string; summary: string; detail?: string } | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { token?: string; summary?: string; detail?: string }
    if (typeof v?.token === "string" && typeof v?.summary === "string") {
      return {
        token: v.token,
        summary: v.summary,
        detail: typeof v.detail === "string" && v.detail.trim() ? v.detail : undefined,
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function parsePolicyColumn(raw: string | null | undefined): AssistantConfirmPolicy {
  if (!raw) return emptyConfirmPolicy()
  try {
    return parseConfirmPolicy(JSON.parse(raw))
  } catch {
    return emptyConfirmPolicy()
  }
}

/** Mark older unresolved confirm rows as superseded when a new prompt appears. */
export function markPriorConfirmsSuperseded(rows: AssistantChatRow[]): AssistantChatRow[] {
  return rows.map((r) =>
    r.kind === "confirm" && !r.resolved ? { ...r, resolved: "superseded" as const } : r,
  )
}

export function markConfirmResolved(
  rows: AssistantChatRow[],
  token: string,
  resolved: "allowed" | "denied",
): AssistantChatRow[] {
  return rows.map((r) =>
    r.kind === "confirm" && r.token === token && !r.resolved ? { ...r, resolved } : r,
  )
}

export function markPriorAsksSuperseded(rows: AssistantChatRow[]): AssistantChatRow[] {
  return rows.map((r) =>
    r.kind === "ask" && !r.resolved ? { ...r, resolved: "superseded" as const } : r,
  )
}

export function markAskResolved(
  rows: AssistantChatRow[],
  token: string,
  resolved: "answered" | "cancelled",
  answers?: AskAnswers,
): AssistantChatRow[] {
  return rows.map((r) =>
    r.kind === "ask" && r.token === token && !r.resolved
      ? { ...r, resolved, answers: answers ?? r.answers }
      : r,
  )
}

export function findPendingAsk(rows: AssistantChatRow[]): {
  token: string
  title: string
  message?: string
  questions: AskQuestion[]
} | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.kind === "ask" && !r.resolved) {
      return {
        token: r.token,
        title: r.title,
        message: r.message,
        questions: r.questions,
      }
    }
  }
  return null
}

function rowToMeta(r: {
  id: string
  username: string
  title: string
  title_locked?: number | null
  status: string
  rows_json: string
  active_run_id?: string | null
  created_at: number
  updated_at: number
}): AssistantConversationMeta {
  const rows = parseRows(r.rows_json)
  return {
    id: r.id,
    username: r.username,
    title: r.title || titleFromRows(rows),
    titleLocked: !!r.title_locked,
    status: (r.status as AssistantConversationStatus) || "idle",
    activeRunId: r.active_run_id || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    preview: previewFromRows(rows),
  }
}

export function listAssistantConversations(username: string, limit = 100): AssistantConversationMeta[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, username, title, title_locked, status, rows_json, active_run_id, created_at, updated_at
       FROM assistant_conversations
       WHERE username = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(username, limit) as Array<{
    id: string
    username: string
    title: string
    title_locked: number | null
    status: string
    rows_json: string
    active_run_id: string | null
    created_at: number
    updated_at: number
  }>
  return rows.map(rowToMeta)
}

export function getAssistantConversation(id: string, username: string): AssistantConversation | null {
  const db = getDb()
  const r = db
    .prepare(
      `SELECT id, username, title, title_locked, status, rows_json, pending_confirm_json, confirm_policy_json, active_run_id, created_at, updated_at
       FROM assistant_conversations WHERE id = ? AND username = ?`,
    )
    .get(id, username) as
    | {
        id: string
        username: string
        title: string
        title_locked: number | null
        status: string
        rows_json: string
        pending_confirm_json: string | null
        confirm_policy_json: string | null
        active_run_id: string | null
        created_at: number
        updated_at: number
      }
    | undefined
  if (!r) return null
  const rows = parseRows(r.rows_json)
  return {
    ...rowToMeta(r),
    rows,
    pendingConfirm: parsePending(r.pending_confirm_json),
    pendingAsk: findPendingAsk(rows),
    confirmPolicy: parsePolicyColumn(r.confirm_policy_json),
  }
}

export function createAssistantConversation(
  username: string,
  opts?: { title?: string; rows?: AssistantChatRow[]; titleLocked?: boolean },
): AssistantConversation {
  const db = getDb()
  const id = newId()
  const now = Date.now()
  const rows = opts?.rows || []
  const titleLocked = !!opts?.titleLocked && !!opts?.title?.trim()
  const title = opts?.title?.trim() || titleFromRows(rows)
  db.prepare(
    `INSERT INTO assistant_conversations
      (id, username, title, title_locked, rows_json, pending_confirm_json, confirm_policy_json, status, active_run_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 'idle', NULL, ?, ?)`,
  ).run(id, username, title, titleLocked ? 1 : 0, JSON.stringify(rows), JSON.stringify(emptyConfirmPolicy()), now, now)
  return {
    id,
    username,
    title,
    titleLocked,
    status: "idle",
    activeRunId: null,
    createdAt: now,
    updatedAt: now,
    preview: previewFromRows(rows),
    rows,
    pendingConfirm: null,
    pendingAsk: findPendingAsk(rows),
    confirmPolicy: emptyConfirmPolicy(),
  }
}

export function updateAssistantConversation(
  id: string,
  username: string,
  patch: {
    rows?: AssistantChatRow[]
    title?: string
    /** When true with title, marks the title as user-set (won't auto-replace from messages). */
    titleLocked?: boolean
    status?: AssistantConversationStatus
    pendingConfirm?: { token: string; summary: string; detail?: string } | null
    activeRunId?: string | null
    confirmPolicy?: AssistantConfirmPolicy
  },
): AssistantConversation | null {
  const existing = getAssistantConversation(id, username)
  if (!existing) return null
  const rows = patch.rows ?? existing.rows
  let titleLocked = existing.titleLocked
  let title = existing.title

  if (typeof patch.title === "string") {
    const next = patch.title.trim()
    if (next) {
      title = next.slice(0, 120)
      titleLocked = patch.titleLocked !== false
    }
  } else if (!titleLocked) {
    const auto = titleFromRows(rows)
    if (
      existing.title === "Conversation" ||
      existing.title === "New conversation" ||
      !existing.title.trim()
    ) {
      title = auto
    }
  }

  if (patch.titleLocked === false) titleLocked = false

  const status = patch.status ?? existing.status
  const pendingConfirm =
    patch.pendingConfirm !== undefined ? patch.pendingConfirm : existing.pendingConfirm
  const activeRunId = patch.activeRunId !== undefined ? patch.activeRunId : existing.activeRunId
  const confirmPolicy = patch.confirmPolicy ?? existing.confirmPolicy
  const now = Date.now()
  const db = getDb()
  db.prepare(
    `UPDATE assistant_conversations
     SET title = ?, title_locked = ?, rows_json = ?, pending_confirm_json = ?, confirm_policy_json = ?, status = ?, active_run_id = ?, updated_at = ?
     WHERE id = ? AND username = ?`,
  ).run(
    title,
    titleLocked ? 1 : 0,
    JSON.stringify(rows),
    pendingConfirm ? JSON.stringify(pendingConfirm) : null,
    JSON.stringify(confirmPolicy),
    status,
    activeRunId,
    now,
    id,
    username,
  )
  return getAssistantConversation(id, username)
}

export function deleteAssistantConversation(id: string, username: string): boolean {
  const db = getDb()
  const info = db.prepare(`DELETE FROM assistant_conversations WHERE id = ? AND username = ?`).run(id, username)
  return info.changes > 0
}
