import { NextRequest, NextResponse } from "next/server"
import { listTasks } from "@/lib/goad-task-store"
import { toPublicGoadTask } from "@/lib/goad-task-api"
import { resolveSession } from "@/lib/session"
import { effectiveImpersonatedOperatorUsername } from "@/lib/admin-impersonation-request"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const myUsername = effectiveImpersonatedOperatorUsername(session, request)

  const all = listTasks()
  // Show only the current user's tasks (always filtered — never return all tasks).
  const filtered = all.filter((t) => !t.username || t.username === myUsername)

  const tasks = filtered.map(toPublicGoadTask)
  return NextResponse.json({ tasks })
}
