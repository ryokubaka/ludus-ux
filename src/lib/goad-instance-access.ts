import { NextResponse, type NextRequest } from "next/server"
import { effectiveImpersonatedOperatorUsername } from "@/lib/admin-impersonation-request"
import { liveSessionIsAdmin } from "@/lib/session-admin-check"
import { writeAppLog } from "@/lib/app-log"
import { listGoadInstances } from "@/lib/goad-ssh"
import { listTasks } from "@/lib/goad-task-store"
import { sameOperator } from "@/lib/operator-name"
import { effectivePrivilegedSshUser } from "@/lib/root-ssh-preflight"
import type { ResolvedSession } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"

export type GoadInstanceAccessFacts = {
  isAdmin: boolean
  caller: string
  /** Linux owner of workspace/<id>/, or null when the instance is not listed. */
  workspaceOwner: string | null
  hostUser: string
  /** Owner of the newest task that ran against this instance. */
  latestTaskOwner: string | null
  /** link-instance claims a workspace no task has run against yet. */
  allowUnclaimed?: boolean
}

/**
 * A named workspace owner is authoritative. While GOAD still writes the
 * workspace as the host account (or it is not listed yet), the newest task
 * on that instance decides.
 */
export function decideGoadInstanceAccess(facts: GoadInstanceAccessFacts): boolean {
  if (facts.isAdmin) return true
  if (!facts.caller.trim()) return false
  const owner = facts.workspaceOwner?.trim() ?? ""
  if (sameOperator(owner, facts.caller)) return true
  const named = owner.length > 0 && !/^\d+$/.test(owner)
  if (named && owner !== "root" && !sameOperator(owner, facts.hostUser)) return false
  if (facts.latestTaskOwner?.trim()) return sameOperator(facts.latestTaskOwner, facts.caller)
  return facts.allowUnclaimed === true
}

/**
 * Instances a GOAD command acts on: the body's instanceId and every REPL
 * `use <id>` line. The REPL selects the instance, so checking only the body
 * field would let a caller name someone else's workspace in the args.
 */
export function goadTargetInstanceIds(args: string, instanceId?: string | null): string[] {
  const ids = new Set<string>()
  if (instanceId?.trim()) ids.add(instanceId.trim())
  const repl = /^--repl\s+([\s\S]*)$/.exec(args.trim())
  if (repl) {
    const body = repl[1].replace(/^["']|["']$/g, "")
    for (const part of body.split(/[;\n]/)) {
      const use = /^use\s+(\S+)$/i.exec(part.trim())
      if (use) ids.add(use[1])
    }
  }
  return [...ids]
}

function latestTaskOwner(instanceId: string): string | null {
  for (const task of listTasks()) {
    if (task.instanceId === instanceId && task.username?.trim()) return task.username
  }
  return null
}

/** 403 unless the caller may act on this GOAD instance. */
export async function assertGoadInstanceAccess(
  session: ResolvedSession,
  request: NextRequest,
  instanceId: string,
  opts: { allowUnclaimed?: boolean } = {},
): Promise<NextResponse | null> {
  if (await liveSessionIsAdmin(session)) return null
  const caller = await effectiveImpersonatedOperatorUsername(session, request)
  let workspaceOwner: string | null = null
  try {
    const listed = (await listGoadInstances()).find((inst) => inst.instanceId === instanceId)
    workspaceOwner = listed ? listed.ownerUserId ?? "" : null
  } catch {
    workspaceOwner = null
  }
  const allowed = decideGoadInstanceAccess({
    isAdmin: false,
    caller,
    workspaceOwner,
    hostUser: effectivePrivilegedSshUser(getSettings().proxmoxSshUser),
    latestTaskOwner: latestTaskOwner(instanceId),
    allowUnclaimed: opts.allowUnclaimed,
  })
  if (allowed) return null
  writeAppLog({
    category: "app",
    event: "goad_instance_denied",
    outcome: "blocked",
    username: caller,
    detail: `instanceId=${instanceId} path=${request.nextUrl.pathname}`,
    level: "warn",
  })
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}
