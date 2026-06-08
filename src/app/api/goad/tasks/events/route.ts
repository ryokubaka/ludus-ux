/**
 * GET /api/goad/tasks/events
 *
 * Lightweight SSE endpoint that emits [TASK_UPDATED] whenever any GOAD task
 * changes status (running → completed / aborted / error). Clients subscribe
 * once and call queryClient.invalidateQueries on each event instead of polling
 * every 3 seconds, eliminating constant HTTP churn when no tasks are active.
 *
 * Event format:  data: [TASK_UPDATED] <taskId> <status>\n\n
 */

import { NextRequest } from "next/server"
import { resolveSession } from "@/lib/session"
import { subscribeToTaskStatusEvents } from "@/lib/goad-task-store"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return new Response("data: [ERROR] Not authenticated\n\n", {
      status: 401,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {}
      }

      // Send a keepalive comment every 20 s so proxies don't close idle connections.
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"))
        } catch {
          clearInterval(keepalive)
        }
      }, 20_000)

      const unsub = subscribeToTaskStatusEvents((taskId, status) => {
        if (!request.signal.aborted) {
          send(`[TASK_UPDATED] ${taskId} ${status}`)
        }
      })

      request.signal.addEventListener("abort", () => {
        clearInterval(keepalive)
        unsub()
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
