import { NextRequest, NextResponse } from "next/server"
import { listTasks } from "@/lib/goad-task-store"
import { getSessionFromRequest } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // When an admin is impersonating, show tasks attributed to the target user.
  const impersonateAs = session.isAdmin
    ? request.headers.get("X-Impersonate-As") || null
    : null
  const myUsername = impersonateAs || session.username

  const all = listTasks()
  // Show only the current user's tasks (always filtered — never return all tasks).
  const filtered = all.filter((t) => !t.username || t.username === myUsername)

  const tasks = filtered.map((t) => ({
    id: t.id,
    command: t.command,
    instanceId: t.instanceId,
    status: t.status,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    exitCode: t.exitCode,
    lineCount: t.lineCount,
  }))
  return NextResponse.json({ tasks })
}
