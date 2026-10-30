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
import { requireSession } from "@/lib/session/require-session"
import {
  effectiveImpersonatedOperatorUsername,
  resolveAdminImpersonationFromRequest,
} from "@/lib/admin/admin-impersonation-request"
import {
  createDeployHandoff,
  getHandoffById,
  linkHandoffToTask,
  pruneOldHandoffs,
} from "@/lib/goad/goad-deploy-handoff-store"
import { setInstanceRangeLocal } from "@/lib/goad/goad-instance-range-store"
import { assertGoadInstanceAccess } from "@/lib/goad/goad-instance-access"
import { sameOperator } from "@/lib/users/operator-name"
import { liveSessionIsAdmin, refreshRevokedAdminCookie } from "@/lib/session/session-admin-check"
import { writePendingNetworkSnapshot, InvalidInstanceIdError, assertSafeInstanceId } from "@/lib/goad/goad-pending-network-fs"
import { assertGoadTaskAccess } from "@/lib/goad/goad-task-api"
import { getTask } from "@/lib/goad/goad-task-store"
import { ludusRequest } from "@/lib/ludus/ludus-client"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"


export async function POST(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const session = gate.session

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

  const imp = await resolveAdminImpersonationFromRequest(session, request)
  const username = (await effectiveImpersonatedOperatorUsername(session, request)).trim()

  if (instanceId) {
    try {
      assertSafeInstanceId(instanceId)
    } catch (err) {
      if (err instanceof InvalidInstanceIdError) {
        return NextResponse.json({ error: "Invalid instance id" }, { status: 400 })
      }
      throw err
    }
    const denied = await assertGoadInstanceAccess(session, request, instanceId)
    if (denied) {
      logLuxRouteAction(request, session, { outcome: "failure", detail: `instanceId=${instanceId} forbidden` })
      return denied
    }
  }

  // The workflow later writes this range with the task owner's key, and the
  // instance link feeds other lookups, so the caller must be able to read it.
  const rangeCheck = await ludusRequest<unknown>(`/range?rangeID=${encodeURIComponent(rangeId)}`, {
    apiKey: imp.apiKey || session.apiKey,
  })
  if (rangeCheck.error || rangeCheck.status !== 200) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: `rangeId=${rangeId} not accessible` })
    return NextResponse.json({ error: "Range not accessible" }, { status: 403 })
  }

  // Persist the range→instance mapping immediately so the server can find it
  // even if the client-side set-range call never completes.
  if (instanceId) setInstanceRangeLocal(instanceId, rangeId)

  // Persist the network rules snapshot to disk so the server-side workflow
  // can apply them after GOAD finishes, exactly as the client would have done.
  let networkRulesJson: string | undefined
  if (networkRules && typeof networkRules === "string" && networkRules.trim()) {
    networkRulesJson = networkRules
    if (instanceId) {
      try {
        writePendingNetworkSnapshot(instanceId, networkRules, username)
      } catch (err) {
        if (err instanceof InvalidInstanceIdError) {
          return NextResponse.json({ error: "Invalid instance id" }, { status: 400 })
        }
        if (err instanceof SyntaxError) {
          return NextResponse.json({ error: "Invalid network rules" }, { status: 400 })
        }
        throw err
      }
    }
  }

  pruneOldHandoffs()

  const handoff = createDeployHandoff({ rangeId, instanceId, username, networkRulesJson })
  logLuxRouteAction(request, session, { detail: `rangeId=${rangeId} handoffId=${handoff.id}` })
  return NextResponse.json({ handoffId: handoff.id })
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const session = gate.session

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

  const isAdmin = await liveSessionIsAdmin(session)
  const notFound = () => {
    logLuxRouteAction(request, session, { outcome: "failure", detail: `handoffId=${handoffId} taskId=${taskId} not found` })
    return refreshRevokedAdminCookie(NextResponse.json({ error: "Not found" }, { status: 404 }), session, isAdmin)
  }

  const handoff = getHandoffById(handoffId)
  const task = getTask(taskId)
  if (!handoff || !task) return notFound()
  if (await assertGoadTaskAccess(session, request, task)) return notFound()
  const caller = await effectiveImpersonatedOperatorUsername(session, request)
  if (!isAdmin && !sameOperator(handoff.username, caller)) return notFound()
  // The workflow trusts this handoff's range and rules for the task's owner.
  if (task.username && !sameOperator(handoff.username, task.username)) return notFound()

  linkHandoffToTask(handoffId, taskId)
  logLuxRouteAction(request, session, { detail: `handoffId=${handoffId} taskId=${taskId}` })
  return refreshRevokedAdminCookie(NextResponse.json({ ok: true }), session, isAdmin)
}
