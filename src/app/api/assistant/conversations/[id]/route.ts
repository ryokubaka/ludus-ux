import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import {
  deleteAssistantConversation,
  getAssistantConversation,
  updateAssistantConversation,
  type AssistantChatRow,
  type AssistantConversationStatus,
} from "@/lib/assistant-conversation-store"
import {
  cancelAssistantRun,
  getActiveRunForConversation,
  reconcileStaleAssistantRun,
} from "@/lib/assistant-run-manager"
import { assistantConversationOwner } from "@/lib/assistant/conversation-owner"

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const owner = assistantConversationOwner(session)
  const { id } = await ctx.params
  reconcileStaleAssistantRun(id, owner)
  const conv = getAssistantConversation(id, owner)
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const live = getActiveRunForConversation(id)
  // Extra guard: never return another owner's conversation (get already filters).
  if (conv.username !== owner) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({
    ...conv,
    activeRunId: live?.id || conv.activeRunId,
    status: live ? "running" : conv.status,
  })
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const owner = assistantConversationOwner(session)
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as {
    rows?: AssistantChatRow[]
    title?: string
    titleLocked?: boolean
    status?: AssistantConversationStatus
    pendingConfirm?: { token: string; summary: string; detail?: string } | null
  } | null
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const updated = updateAssistantConversation(id, owner, {
    rows: Array.isArray(body.rows) ? body.rows : undefined,
    title: body.title,
    titleLocked: body.titleLocked,
    status: body.status,
    pendingConfirm: body.pendingConfirm,
  })
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const owner = assistantConversationOwner(session)
  const { id } = await ctx.params
  cancelAssistantRun({ conversationId: id, username: owner })
  const ok = deleteAssistantConversation(id, owner)
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
