import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { getAssistantConversation } from "@/lib/assistant-conversation-store"
import { cancelAssistantRun } from "@/lib/assistant-run-manager"
import { assistantConversationOwner } from "@/lib/assistant/conversation-owner"

/** Explicitly stop the active background run for this conversation. */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const owner = assistantConversationOwner(session)
  const { id } = await ctx.params
  const conv = getAssistantConversation(id, owner)
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const ok = cancelAssistantRun({ conversationId: id, username: owner })
  return NextResponse.json({ ok, cancelled: ok })
}
