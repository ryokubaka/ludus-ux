/**
 * /api/range/ops — testing mode start/stop tracking.
 *
 * Completion order:
 * 1. PocketBase testingEnabled already matches expected
 * 2. Op-scoped ansible log proves success (primary when PB lags)
 * 3. Ludus GET /range agrees with expected → best-effort PB patch
 *
 * We do NOT fail ops on rangeState ERROR/ABORTED — testing ansible runs outside deploy state.
 * We do NOT reconcile PocketBase on passive status reads (see pb-status route).
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { resolveSession } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { fetchPbRangeStatus } from "@/lib/pocketbase-client"
import {
  createRangeOp,
  getActiveRangeOp,
  markRangeOpRunning,
  completeRangeOp,
  pruneOldRangeOps,
  type RangeOp,
  type RangeOpType,
} from "@/lib/range-op-store"
import { recordLuxTestingOpTerminal } from "@/lib/range-testing-audit"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import {
  TESTING_OP_MIN_AGE_MS,
  bestEffortSyncPbTestingEnabled,
  clearTestingOpLogMarker,
  ludusApiTestingEnabled,
  noteTestingOpLogMarker,
  readTestingOpLogSlice,
  testingOpLogSliceProvesComplete,
} from "@/lib/testing-mode-pb-reconcile"
import { readLudusRangeLogsForReconcile } from "@/lib/goad-ludus-reconcile"

function getEffective(
  request: NextRequest,
  session: {
    apiKey: string
    username: string
    isAdmin: boolean
    impersonationApiKey?: string
    impersonationUserId?: string
    impersonationLudusUserId?: string
    impersonationSshLogin?: string
  },
) {
  const imp = resolveAdminImpersonationFromRequest(session, request)
  return {
    effectiveApiKey: imp.apiKey || session.apiKey,
    effectiveUsername:
      imp.apiKey
        ? (imp.sshLogin || imp.ludusPrincipal || session.username).trim()
        : session.username,
    ludusUserOverride: imp.apiKey ? imp.ludusPrincipal ?? undefined : undefined,
  }
}

const TESTING_OP_MAX_AGE_MS = 20 * 60_000
const TESTING_STOP_AUTO_RETRY_MS = 4 * 60_000
const testingStopRetriedOpIds = new Set<string>()

function forgetTestingStopRetry(opId: string) {
  testingStopRetriedOpIds.delete(opId)
  clearTestingOpLogMarker(opId)
}

type OpCtx = { effectiveApiKey: string; ludusUserOverride?: string }

function completeTestingOpSuccess(
  op: RangeOp,
  ctx: OpCtx,
  pbPatchReason: string,
) {
  const expectedBool = op.expectedTestingEnabled === 1
  void bestEffortSyncPbTestingEnabled(op.rangeId, expectedBool, pbPatchReason)
  forgetTestingStopRetry(op.id)
  completeRangeOp(op.id, true)
  recordLuxTestingOpTerminal(op, true, {
    apiKey: ctx.effectiveApiKey,
    userOverride: ctx.ludusUserOverride,
  })
}

async function ansibleProvesOpComplete(
  op: RangeOp,
  ctx: OpCtx,
  opts?: { skipMinAge?: boolean },
): Promise<boolean> {
  if (!opts?.skipMinAge && Date.now() - op.startedAt < TESTING_OP_MIN_AGE_MS) {
    return false
  }
  const slice = await readTestingOpLogSlice(op.id, op.rangeId, ctx.effectiveApiKey)
  return testingOpLogSliceProvesComplete(op.opType, slice)
}

async function checkCompletion(
  op: RangeOp,
  ctx: OpCtx,
  rangeId: string,
): Promise<RangeOp> {
  if (op.status === "completed" || op.status === "error") return op

  const expectedBool = op.expectedTestingEnabled === 1

  if (op.status === "pending") {
    markRangeOpRunning(op.id)
    return { ...op, status: "running" }
  }

  // Timeout — last chance via ansible log (not PB-only).
  if (op.status === "running" && Date.now() - op.startedAt > TESTING_OP_MAX_AGE_MS) {
    if (await ansibleProvesOpComplete(op, ctx, { skipMinAge: true })) {
      completeTestingOpSuccess(op, ctx, `op ${op.opType} timeout (ansible complete)`)
      return { ...op, status: "completed" }
    }
    forgetTestingStopRetry(op.id)
    completeRangeOp(op.id, false)
    recordLuxTestingOpTerminal(op, false, {
      apiKey: ctx.effectiveApiKey,
      userOverride: ctx.ludusUserOverride,
    })
    return { ...op, status: "error" }
  }

  try {
    const pbStatus = await fetchPbRangeStatus(rangeId)
    const testingEnabled = pbStatus?.testingEnabled

    if (testingEnabled === expectedBool) {
      completeTestingOpSuccess(op, ctx, `op ${op.opType} (PB matched)`)
      return { ...op, status: "completed" }
    }

    if (await ansibleProvesOpComplete(op, ctx)) {
      completeTestingOpSuccess(op, ctx, `op ${op.opType} (ansible since op start)`)
      return { ...op, status: "completed" }
    }

    const ludusFlag = await ludusApiTestingEnabled(
      rangeId,
      ctx.effectiveApiKey,
      ctx.ludusUserOverride,
    )
    if (ludusFlag === expectedBool) {
      completeTestingOpSuccess(op, ctx, `op ${op.opType} (Ludus API matched)`)
      return { ...op, status: "completed" }
    }

    if (
      op.opType === "testing_stop" &&
      op.status === "running" &&
      testingEnabled === true &&
      Date.now() - op.startedAt >= TESTING_STOP_AUTO_RETRY_MS &&
      Date.now() - op.startedAt < TESTING_OP_MAX_AGE_MS &&
      !testingStopRetriedOpIds.has(op.id)
    ) {
      testingStopRetriedOpIds.add(op.id)
      void ludusRequest(`/testing/stop?rangeID=${encodeURIComponent(rangeId)}`, {
        method: "PUT",
        apiKey: ctx.effectiveApiKey,
        userOverride: ctx.ludusUserOverride,
        timeout: 5 * 60_000,
      }).catch(() => {})
    }
  } catch {
    // Non-fatal — poller retries
  }

  return op
}

export async function GET(request: NextRequest) {
  try { pruneOldRangeOps() } catch {}

  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const rangeId = request.nextUrl.searchParams.get("rangeId")
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const ctx = getEffective(request, session)

  let op = getActiveRangeOp(rangeId, ctx.effectiveUsername)
  if (op) {
    op = await checkCompletion(op, ctx, rangeId)
  }

  return NextResponse.json({ op })
}

export async function POST(request: NextRequest) {
  try { pruneOldRangeOps() } catch {}
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: { rangeId?: string; opType?: string; dismissStuckOp?: boolean }
  try { body = await request.json() } catch { body = {} }

  const { rangeId, opType, dismissStuckOp } = body
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const ctx = getEffective(request, session)

  if (dismissStuckOp === true) {
    const stuck = getActiveRangeOp(rangeId, ctx.effectiveUsername)
    if (stuck) {
      forgetTestingStopRetry(stuck.id)
      completeRangeOp(stuck.id, false)
    }
    logLuxRouteAction(request, session, { detail: `dismissStuckOp rangeId=${rangeId}` })
    return NextResponse.json({ op: null, dismissed: Boolean(stuck) })
  }

  if (opType !== "testing_start" && opType !== "testing_stop") {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "invalid opType" })
    return NextResponse.json({ error: "opType must be testing_start or testing_stop" }, { status: 400 })
  }

  const staleOp = getActiveRangeOp(rangeId, ctx.effectiveUsername)
  if (staleOp) {
    forgetTestingStopRetry(staleOp.id)
    completeRangeOp(staleOp.id, false)
  }

  const op = createRangeOp(rangeId, ctx.effectiveUsername, opType as RangeOpType)

  const logsBefore = await readLudusRangeLogsForReconcile(rangeId, {
    taskLudusApiKey: ctx.effectiveApiKey,
  })
  await noteTestingOpLogMarker(op.id, logsBefore, rangeId)

  const ludusPath = opType === "testing_start"
    ? `/testing/start?rangeID=${encodeURIComponent(rangeId)}`
    : `/testing/stop?rangeID=${encodeURIComponent(rangeId)}`

  const result = await ludusRequest(ludusPath, {
    method: "PUT",
    apiKey: ctx.effectiveApiKey,
    userOverride: ctx.ludusUserOverride,
    timeout: 5 * 60_000,
  })

  const ludusTimedOut = result.status === 0

  if (!ludusTimedOut && result.error && result.status !== 200 && result.status !== 204 && result.status !== 201) {
    forgetTestingStopRetry(op.id)
    completeRangeOp(op.id, false)
    recordLuxTestingOpTerminal(op, false, {
      apiKey: ctx.effectiveApiKey,
      userOverride: ctx.ludusUserOverride,
    })
    logLuxRouteAction(request, session, { outcome: "failure", detail: result.error || `HTTP ${result.status}` })
    return NextResponse.json(
      { error: result.error || `Ludus returned HTTP ${result.status}` },
      { status: result.status || 500 },
    )
  }

  markRangeOpRunning(op.id)
  logLuxRouteAction(request, session, { detail: `${opType} rangeId=${rangeId}` })
  return NextResponse.json({ op: { ...op, status: "running" } })
}
