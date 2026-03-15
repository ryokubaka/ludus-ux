import { NextRequest, NextResponse } from "next/server"
import { getTask } from "@/lib/goad-task-store"
import { getSessionFromRequest } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const task = getTask(params.taskId)
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }

  // Enforce ownership: admins can see any task; users can only see their own.
  const impersonateAs = session.isAdmin
    ? request.headers.get("X-Impersonate-As") || null
    : null
  const effectiveUser = impersonateAs || session.username
  if (!session.isAdmin && task.username && task.username !== effectiveUser) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json(task)
}
