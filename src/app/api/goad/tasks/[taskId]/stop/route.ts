import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { effectiveImpersonatedOperatorUsername } from "@/lib/admin-impersonation-request"
import { abortTask, completeTask } from "@/lib/goad-task-store"
import { invokeCleanup } from "@/lib/task-cleanup-registry"
import { logLuxRouteAction } from "@/lib/lux-api-audit"


/**
 * POST /api/goad/tasks/[taskId]/stop
 *
 * Kills the in-flight SSH/ansible process for a task by invoking its registered
 * cleanup function (sends Ctrl+C to the PTY then closes the SSH connection).
 * Works even when the original SSE client (execute route) has disconnected.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { taskId } = await params

  let asError = false
  try {
    const body = await request.json()
    asError = body?.asError === true
  } catch {
    asError = false
  }

  // Enforce ownership: only the task owner (or an admin) may stop it.
  const { getTask } = await import("@/lib/goad-task-store")
  const task = getTask(taskId)
  if (task) {
    const effectiveUser = effectiveImpersonatedOperatorUsername(session, request)
    if (!session.isAdmin && task.username && task.username !== effectiveUser) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
  }

  // Send SIGINT to the remote process via the SSH PTY cleanup function
  const killed = invokeCleanup(taskId)

  // Mark the task aborted, or failed when the range itself errored.
  // A user Stop leaves the task aborted. A range ERROR is not an abort.
  if (asError) completeTask(taskId, 1, "error")
  else abortTask(taskId)

  logLuxRouteAction(request, session, { detail: `taskId=${taskId} killed=${killed}` })
  return NextResponse.json({ success: true, killed })
}
