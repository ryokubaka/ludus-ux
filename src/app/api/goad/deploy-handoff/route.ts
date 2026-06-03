/**
 * POST /api/goad/deploy-handoff — register wizard intent before the execute call
 * PATCH /api/goad/deploy-handoff — link handoffId to taskId after execute returns
 *
 * The wizard calls POST before starting the SSE stream, giving the server all
 * context needed to complete post-deploy linkage (range assignment, pending-network
 * application) even if the user navigates away. After the execute call returns the
 * taskId, the wizard calls PATCH so the server can look up the handoff on task
 * completion.
 *
 * See lib/goad-deploy-handoff-store.ts for the persistence layer.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import {
  createDeployHandoff,
  linkHandoffToTask,
  pruneOldHandoffs,
} from "@/lib/goad-deploy-handoff-store"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"
import { writePendingNetworkSnapshot } from "@/lib/goad-pending-network-fs"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: {
    rangeId?: string
    instanceId?: string
    networkRules?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { rangeId, instanceId, networkRules } = body
  if (!rangeId) {
    return NextResponse.json({ error: "rangeId is required" }, { status: 400 })
  }

  // Resolve the effective username for multi-user / impersonation scenarios.
  const imp = resolveAdminImpersonationFromRequest(session, request)
  const sshUser = ((imp.apiKey ? imp.sshLogin || imp.ludusPrincipal : null) || session.username || "").trim()
  const username = sshUser

  // Persist the range→instance mapping immediately so the server can find it
  // even if the client-side set-range call never completes.
  if (instanceId) {
    setInstanceRangeLocal(instanceId, rangeId)
  }

  // Persist the network rules snapshot to disk so the server-side workflow
  // can apply them after GOAD finishes, exactly as the client would have done.
  let networkRulesJson: string | undefined
  if (networkRules && typeof networkRules === "string" && networkRules.trim()) {
    networkRulesJson = networkRules
    if (instanceId) {
      writePendingNetworkSnapshot(instanceId, networkRules)
    }
  }

  pruneOldHandoffs()

  const handoff = createDeployHandoff({ rangeId, instanceId, username, networkRulesJson })
  logLuxRouteAction(request, session, { detail: `rangeId=${rangeId} handoffId=${handoff.id}` })
  return NextResponse.json({ handoffId: handoff.id })
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { handoffId?: string; taskId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { handoffId, taskId } = body
  if (!handoffId || !taskId) {
    return NextResponse.json({ error: "handoffId and taskId are required" }, { status: 400 })
  }

  linkHandoffToTask(handoffId, taskId)
  logLuxRouteAction(request, session, { detail: `handoffId=${handoffId} taskId=${taskId}` })
  return NextResponse.json({ ok: true })
}
