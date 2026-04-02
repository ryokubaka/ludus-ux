import { NextRequest, NextResponse } from "next/server"
import { updateTaskInstance } from "@/lib/goad-task-store"
import { getSessionFromRequest } from "@/lib/session"

export const dynamic = "force-dynamic"

/**
 * POST /api/goad/tasks/{taskId}/link-instance
 * Body: { instanceId: string }
 *
 * Retroactively associates a task with a GOAD instance ID.
 * Called from the new-instance deployment page once the instance is discovered
 * (the task was created before the instance existed, so instanceId was null).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { taskId } = await params
  const body = await request.json().catch(() => ({}))
  const { instanceId } = body as { instanceId?: string }

  if (!instanceId) {
    return NextResponse.json({ error: "instanceId is required" }, { status: 400 })
  }

  const ok = updateTaskInstance(taskId, instanceId)
  if (!ok) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, taskId, instanceId })
}
