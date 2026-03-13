import { NextRequest } from "next/server"
import { subscribeToTask } from "@/lib/goad-task-store"

export const dynamic = "force-dynamic"

/**
 * SSE endpoint that replays all existing lines for a task, then streams
 * any new lines in real-time. Useful for resuming after page navigation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const { taskId } = params
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
