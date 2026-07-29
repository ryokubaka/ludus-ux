import { NextRequest } from "next/server"
import { resolveSession } from "@/lib/session"
import { getAssistantRun, subscribeAssistantRun } from "@/lib/assistant-run-manager"
import { assistantConversationOwner } from "@/lib/assistant/conversation-owner"

export const maxDuration = 300

/** SSE: replay + live events for a background assistant run. */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const session = await resolveSession(request)
  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 })
  }
  const owner = assistantConversationOwner(session)
  const { runId } = await ctx.params
  const run = getAssistantRun(runId)
  if (!run || run.username !== owner) {
    return new Response(JSON.stringify({ error: "Run not found" }), { status: 404 })
  }

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          /* closed */
        }
      }
      send({
        type: "run_meta",
        runId: run.id,
        conversationId: run.conversationId,
        status: run.status,
      })
      unsubscribe = subscribeAssistantRun(
        runId,
        (ev) => send(ev),
        (status) => {
          send({ type: "run_finished", status })
          try {
            controller.close()
          } catch {
            /* ignore */
          }
        },
      )
      request.signal.addEventListener("abort", () => {
        unsubscribe?.()
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      })
    },
    cancel() {
      unsubscribe?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
