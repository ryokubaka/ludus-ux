/**
 * GET /api/admin/app-logs/stream — SSE tail + live application/auth log lines.
 */

import { NextRequest } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { formatAppLogLine, queryAppLogs, subscribeAppLogEvents } from "@/lib/app-log"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return new Response("data: [ERROR] Admin access required\n\n", {
      status: 403,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  const categoryParam = request.nextUrl.searchParams.get("category")
  const category =
    categoryParam === "auth" || categoryParam === "app" ? categoryParam : undefined

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {
          /* stream closed */
        }
      }

      // Flush headers through nginx/proxies before any DB work.
      try {
        controller.enqueue(encoder.encode(": connected\n\n"))
      } catch {
        /* stream closed */
      }

      const tail = queryAppLogs({ category: category as "auth" | "app" | undefined, limit: 100 })
      for (const row of [...tail].reverse()) {
        send(formatAppLogLine(row))
      }

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"))
        } catch {
          clearInterval(keepalive)
        }
      }, 20_000)

      const unsub = subscribeAppLogEvents((line) => {
        if (request.signal.aborted) return
        if (category === "auth" && !line.includes("[AUTH]")) return
        if (category === "app" && !line.includes("[APP]")) return
        send(line)
      })

      request.signal.addEventListener("abort", () => {
        clearInterval(keepalive)
        unsub()
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
