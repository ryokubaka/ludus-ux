import { NextRequest } from "next/server"
import { streamGoadCommand, isGoadConfigured, readGoadRangeId } from "@/lib/goad-ssh"
import { createTask, appendLine, completeTask, abortTask } from "@/lib/goad-task-store"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { registerCleanup, deregisterCleanup, invokeCleanup } from "@/lib/task-cleanup-registry"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  if (!isGoadConfigured()) {
    return new Response(
      "data: [ERROR] GOAD SSH not configured. Set LUDUS_SSH_HOST in your environment.\n\n",
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    )
  }

  const body = await request.json().catch(() => ({ args: "", instanceId: undefined }))
  const { args, instanceId, impersonateAs, rangeId: bodyRangeId } = body as {
    args?: string
    instanceId?: string
    impersonateAs?: { username: string; apiKey: string }
    /** Explicit rangeID to target — passed by the caller when a dedicated range
     *  is known up-front (e.g. new-instance flow where the range was pre-created). */
    rangeId?: string
  }

  if (!args) {
    return new Response("data: [ERROR] No command args provided\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  const session = await getSessionFromRequest(request)

  // Impersonation: admin SSHes as root and runs commands via sudo.
  // Verify the caller is an admin before allowing impersonation.
  if (impersonateAs && !session?.isAdmin) {
    return new Response("data: [ERROR] Admin session required for impersonation\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  // ── Determine the rangeId to inject as LUDUS_RANGE_ID ────────────────────
  // Priority: 1) explicit in request body (new-instance flow)
  //           2) read from .goad_range_id file in workspace (existing instance)
  //           3) omit (GOAD uses its own default range selection)
  let effectiveRangeId: string | undefined = bodyRangeId || undefined
  if (!effectiveRangeId && instanceId && !impersonateAs) {
    try {
      const settings = getSettings()
      const rootCreds = settings.proxmoxSshPassword
        ? { username: settings.proxmoxSshUser || "root", password: settings.proxmoxSshPassword }
        : undefined
      effectiveRangeId = (await readGoadRangeId(instanceId, rootCreds)) ?? undefined
    } catch {
      // SSH unavailable — proceed without range targeting
    }
  }

  const apiKey = session?.apiKey ?? null

  // Use the session's own credentials so GOAD runs as the logged-in user,
  // using their personal LUDUS_API_KEY and their own GOAD workspace.
  // When impersonating, creds are ignored — root SSH + sudo handles auth.
  const creds = (!impersonateAs && session?.sshPassword)
    ? { username: session.username, password: session.sshPassword }
    : undefined

  // Task is attributed to the impersonated user so it appears in their history
  const taskOwner = impersonateAs?.username ?? session?.username
  const taskId = createTask(args, instanceId, taskOwner)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) => {
        try { controller.enqueue(encoder.encode(`data: ${line}\n\n`)) } catch {}
        appendLine(taskId, line)
      }

      // Emit task ID first so the client can resume after navigation
      try { controller.enqueue(encoder.encode(`data: [TASKID] ${taskId}\n\n`)) } catch {}

      let cleanup: (() => void) | undefined

      const closePromise = new Promise<void>((resolve) => {
        streamGoadCommand(
          args,
          apiKey,
          (line) => { if (!request.signal.aborted) send(line) },
          (code) => {
            deregisterCleanup(taskId)
            completeTask(taskId, code, code === 0 ? "completed" : "error")
            send(`[EXIT] Command exited with code ${code}`)
            try { controller.close() } catch {}
            resolve()
          },
          (err) => {
            deregisterCleanup(taskId)
            completeTask(taskId, -1, "error")
            send(`[ERROR] ${err.message}`)
            try { controller.close() } catch {}
            resolve()
          },
          creds,
          impersonateAs,
          effectiveRangeId
        ).then((fn) => {
          cleanup = fn
          // Register so the /stop endpoint can kill the process even after
          // the SSE client disconnects (sign-out, navigation, etc.)
          registerCleanup(taskId, fn)
        })
      })

      request.signal.addEventListener("abort", () => {
        // Client disconnected — try via registry first (removes it), fallback to
        // local reference. This handles the case where the .then hasn't resolved yet.
        if (!invokeCleanup(taskId)) cleanup?.()
        abortTask(taskId)
        try { controller.close() } catch {}
      })

      await closePromise
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
