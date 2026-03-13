import { NextRequest, NextResponse } from "next/server"
import { listTasks } from "@/lib/goad-task-store"
import { getSessionFromRequest } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  // When an admin is impersonating, show tasks attributed to the target user.
  const impersonateAs = session?.isAdmin
    ? request.headers.get("X-Impersonate-As") || null
    : null
  const myUsername = impersonateAs || session?.username

  const all = listTasks()
  // Show only the current user's tasks.
  // Tasks created before username tracking (no username field) are hidden
  // to avoid leaking historical cross-user data.
  const filtered = myUsername
    ? all.filter((t) => !t.username || t.username === myUsername)
    : all

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
