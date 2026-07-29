import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import {
  createAssistantConversation,
  listAssistantConversations,
  type AssistantChatRow,
} from "@/lib/assistant-conversation-store"
import { assistantConversationOwner } from "@/lib/assistant/conversation-owner"

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const owner = assistantConversationOwner(session)
  if (!owner) return NextResponse.json({ error: "No username" }, { status: 400 })
  // Strict per-owner list — impersonation switches the owner to the target user.
  const conversations = listAssistantConversations(owner)
  return NextResponse.json({ owner, conversations })
}

export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const owner = assistantConversationOwner(session)
  if (!owner) return NextResponse.json({ error: "No username" }, { status: 400 })

  const body = (await request.json().catch(() => null)) as {
    title?: string
    rows?: AssistantChatRow[]
  } | null

  const conv = createAssistantConversation(owner, {
    title: body?.title,
    rows: Array.isArray(body?.rows) ? body!.rows : [],
    titleLocked: !!body?.title?.trim(),
  })
  return NextResponse.json(conv)
}
