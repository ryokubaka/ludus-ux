import { NextRequest, NextResponse } from "next/server"
import { getTask, updateTaskInstance } from "@/lib/goad-task-store"
import { assertGoadTaskAccess } from "@/lib/goad-task-api"
import { resolveSession } from "@/lib/session"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

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
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { taskId } = await params
  const body = await request.json().catch(() => ({}))
  const { instanceId } = body as { instanceId?: string }

  if (!instanceId) {
    return NextResponse.json({ error: "instanceId is required" }, { status: 400 })
  }

  const task = getTask(taskId)
  if (!task) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "Task not found" })
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }

  const denied = assertGoadTaskAccess(session, request, task)
  if (denied) return denied

  const ok = updateTaskInstance(taskId, instanceId)
  if (!ok) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "Task not found" })
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }

  logLuxRouteAction(request, session, { detail: `taskId=${taskId} instanceId=${instanceId}` })
  return NextResponse.json({ ok: true, taskId, instanceId })
}
