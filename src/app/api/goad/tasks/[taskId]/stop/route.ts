import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { abortTask } from "@/lib/goad-task-store"
import { invokeCleanup } from "@/lib/task-cleanup-registry"

export const dynamic = "force-dynamic"

/**
 * POST /api/goad/tasks/[taskId]/stop
 *
 * Kills the in-flight SSH/ansible process for a task by invoking its registered
 * cleanup function (sends Ctrl+C to the PTY then closes the SSH connection).
 * Works even when the original SSE client (execute route) has disconnected.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { taskId } = params

  // Send SIGINT to the remote process via the SSH PTY cleanup function
  const killed = invokeCleanup(taskId)

  // Mark task as aborted in the store regardless (handles the case where
  // cleanup is not registered but the task status is still "running")
  abortTask(taskId)

  return NextResponse.json({ success: true, killed })
}
