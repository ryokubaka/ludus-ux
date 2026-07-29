import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { isAssistantConfigured } from "@/lib/assistant/assistant-config"
import { getAssistantConversation } from "@/lib/assistant-conversation-store"
import { resolveAssistantAsk } from "@/lib/assistant-run-manager"
import { SESSION_COOKIE } from "@/lib/session-edge"
import { assistantConversationOwner } from "@/lib/assistant/conversation-owner"
import type { AskAnswers } from "@/lib/assistant/ask-user"

export const maxDuration = 300

function luxOriginFromRequest(request: NextRequest): string {
  const env = process.env.LUX_INTERNAL_ORIGIN?.trim()
  if (env) return env.replace(/\/$/, "")
  return "http://127.0.0.1:3000"
}

/** Resolve an ask_user interactive prompt (buttons / text) and continue the run. */
export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const cfg = isAssistantConfigured()
  if (!cfg.ok) {
    return NextResponse.json({ error: cfg.reason }, { status: 503 })
  }

  const owner = assistantConversationOwner(session)
  if (!owner) return NextResponse.json({ error: "No username" }, { status: 400 })

  const body = (await request.json().catch(() => null)) as {
    conversationId?: string
    askToken?: string
    answers?: AskAnswers
    cancelled?: boolean
    selectedRangeId?: string | null
  } | null

  if (!body?.conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 })
  }
  if (!body.askToken?.trim()) {
    return NextResponse.json({ error: "askToken required" }, { status: 400 })
  }

  const conv = getAssistantConversation(body.conversationId, owner)
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

  const cookieHeader = request.headers.get("cookie") || `${SESSION_COOKIE}=`
  try {
    const started = await resolveAssistantAsk({
      conversationId: body.conversationId,
      username: owner,
      askToken: body.askToken.trim(),
      answers: body.answers,
      cancelled: !!body.cancelled,
      selectedRangeId: body.selectedRangeId,
      toolCtx: {
        apiKey: (session.impersonationApiKey || session.apiKey || "").trim(),
        cookieHeader,
        luxOrigin: luxOriginFromRequest(request),
        impersonateAs: session.impersonationUserId || undefined,
        impersonateApikey: session.impersonationApiKey || undefined,
      },
    })
    return NextResponse.json(started)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}
