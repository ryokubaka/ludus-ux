import { NextRequest, NextResponse } from "next/server"
import { getTask, updateTaskPhase, setTaskHasNetworkRules } from "@/lib/goad-task-store"
import { assertGoadTaskAccess, toGoadTaskDetail } from "@/lib/goad-task-api"
import { resolveSession } from "@/lib/session"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { taskId } = await params
  const task = getTask(taskId)
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }

  const denied = assertGoadTaskAccess(session, request, task)
  if (denied) return denied

  return NextResponse.json(toGoadTaskDetail(task))
}

/** PATCH /api/goad/tasks/[taskId] — update deploy-queue phase metadata */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { taskId } = await params
  const task = getTask(taskId)
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }

  const denied = assertGoadTaskAccess(session, request, task)
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as {
    phase?: "network-deploy" | null
    hasNetworkRules?: boolean
  }

  if ("phase" in body) updateTaskPhase(taskId, body.phase ?? null)
  if ("hasNetworkRules" in body) setTaskHasNetworkRules(taskId, body.hasNetworkRules ?? false)

  logLuxRouteAction(request, session, { detail: `taskId=${taskId}` })
  return NextResponse.json({ ok: true })
}
