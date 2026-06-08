import { NextRequest, NextResponse } from "next/server"
import type { GoadTask } from "@/lib/goad-task-store"
import { effectiveImpersonatedOperatorUsername } from "@/lib/admin-impersonation-request"
import type { ResolvedSession } from "@/lib/session"

/** Client-safe task shape — no secrets or log lines (list + correlation). */
export type PublicGoadTask = {
  id: string
  command: string
  instanceId?: string
  status: GoadTask["status"]
  startedAt: number
  endedAt?: number
  exitCode?: number
  lineCount: number
  phase?: "network-deploy" | null
  hasNetworkRules?: boolean
}

/** Task detail for history/resume — includes log lines; still no ludusApiKey. */
export type GoadTaskDetail = PublicGoadTask & {
  lines: string[]
}

export function toPublicGoadTask(task: GoadTask): PublicGoadTask {
  return {
    id: task.id,
    command: task.command,
    instanceId: task.instanceId,
    status: task.status,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    exitCode: task.exitCode,
    lineCount: task.lineCount,
    phase: task.phase ?? null,
    hasNetworkRules: task.hasNetworkRules ?? false,
  }
}

export function toGoadTaskDetail(task: GoadTask): GoadTaskDetail {
  return {
    ...toPublicGoadTask(task),
    lines: task.lines,
  }
}

/**
 * Enforce GOAD task ownership. Returns a 404 response when denied, null when allowed.
 */
export function assertGoadTaskAccess(
  session: ResolvedSession,
  request: NextRequest,
  task: GoadTask,
): NextResponse | null {
  const effectiveUser = effectiveImpersonatedOperatorUsername(session, request)
  if (!session.isAdmin && task.username && task.username !== effectiveUser) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return null
}
