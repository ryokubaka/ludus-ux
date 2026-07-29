import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { isAssistantConfigured } from "@/lib/assistant/assistant-config"
import { getAssistantConversation } from "@/lib/assistant-conversation-store"
import { cancelAssistantRun, startAssistantRun } from "@/lib/assistant-run-manager"
import { SESSION_COOKIE } from "@/lib/session-edge"
import { assistantConversationOwner } from "@/lib/assistant/conversation-owner"

export const maxDuration = 300

function luxOriginFromRequest(request: NextRequest): string {
  const env = process.env.LUX_INTERNAL_ORIGIN?.trim()
  if (env) return env.replace(/\/$/, "")
  return "http://127.0.0.1:3000"
}

/**
 * Start a background assistant run (continues if the browser disconnects).
 * Returns { runId, conversationId }; attach to GET /api/assistant/runs/[runId]/stream.
 */
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
    userText?: string
    messages?: Array<{ role: "user" | "assistant"; content: string }>
    confirmToken?: string
    selectedRangeId?: string | null
    /** If true and a run is active, cancel it without starting a new one. */
    cancelOnly?: boolean
  } | null

  if (!body?.conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 })
  }

  const conv = getAssistantConversation(body.conversationId, owner)
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

  if (body.cancelOnly) {
    const ok = cancelAssistantRun({ conversationId: body.conversationId, username: owner })
    return NextResponse.json({ ok, cancelled: ok })
  }

  const userText =
    (typeof body.userText === "string" && body.userText.trim()) ||
    (Array.isArray(body.messages)
      ? [...body.messages].reverse().find((m) => m.role === "user")?.content?.trim()
      : "") ||
    ""
  if (!userText) {
    return NextResponse.json({ error: "userText required" }, { status: 400 })
  }

  const cookieHeader = request.headers.get("cookie") || `${SESSION_COOKIE}=`
  try {
    const started = await startAssistantRun({
      conversationId: body.conversationId,
      username: owner,
      userText,
      confirmToken: body.confirmToken,
      selectedRangeId: body.selectedRangeId,
      toolCtx: {
        apiKey: (session.impersonationApiKey || session.apiKey || "").trim(),
        cookieHeader,
        luxOrigin: luxOriginFromRequest(request),
        impersonateAs: session.impersonationUserId || undefined,
        impersonateApikey: session.impersonationApiKey || undefined,
        confirmToken: body.confirmToken,
      },
    })
    return NextResponse.json(started)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
