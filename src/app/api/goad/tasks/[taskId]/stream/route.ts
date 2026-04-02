import { NextRequest } from "next/server"
import { subscribeToTask, getTask } from "@/lib/goad-task-store"
import { getSessionFromRequest } from "@/lib/session"

export const dynamic = "force-dynamic"

/**
 * SSE endpoint that replays all existing lines for a task, then streams
 * any new lines in real-time. Useful for resuming after page navigation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return new Response("data: [ERROR] Not authenticated\n\n", {
      status: 401,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  const { taskId } = await params

  // Enforce ownership before opening the stream.
  const task = getTask(taskId)
  if (task) {
    const impersonateAs = session.isAdmin
      ? request.headers.get("X-Impersonate-As") || null
      : null
    const effectiveUser = impersonateAs || session.username
    if (!session.isAdmin && task.username && task.username !== effectiveUser) {
      return new Response("data: [ERROR] Not found\n\n", {
        status: 404,
        headers: { "Content-Type": "text/event-stream" },
      })
    }
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (line: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${line}\n\n`))
        } catch {}
      }

      const unsubscribe = subscribeToTask(
        taskId,
        (line) => {
          if (!request.signal.aborted) send(line)
        },
        (exitCode) => {
          if (exitCode !== null) {
            send(`[EXIT] Command exited with code ${exitCode}`)
          } else {
            send(`[EXIT] Task not found or no exit code available`)
          }
          try { controller.close() } catch {}
        }
      )

      request.signal.addEventListener("abort", () => {
        unsubscribe()
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
