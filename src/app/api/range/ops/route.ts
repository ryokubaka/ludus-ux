/**
 * /api/range/ops
 *
 * GET  ?rangeId=xxx
 *   Returns the active (pending/running) range operation for the effective user.
 *   On each poll the server also checks the current Ludus range state and
 *   auto-completes the op when the expected outcome is detected.
 *
 * POST { rangeId, opType: "testing_start" | "testing_stop" }
 *   Creates a DB op record, calls the Ludus testing API, then returns the op.
 *   The client can immediately start polling GET to track progress.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { fetchPbRangeStatus } from "@/lib/pocketbase-client"
import {
  createRangeOp,
  getActiveRangeOp,
  markRangeOpRunning,
  completeRangeOp,
  pruneOldRangeOps,
  type RangeOpType,
} from "@/lib/range-op-store"
import { recordLuxTestingOpTerminal } from "@/lib/range-testing-audit"

// Remove the bare getDb() call — it was being tree-shaken by webpack.
// Schema creation is handled inside each exported store function instead.

/** Resolve impersonation state and return { effectiveApiKey, effectiveUsername }. */
function getEffective(
  request: NextRequest,
  session: { apiKey: string; username: string; isAdmin: boolean; impersonationApiKey?: string; impersonationUserId?: string },
) {
  const imp = resolveAdminImpersonationFromRequest(session, request)
  return {
    effectiveApiKey: imp.apiKey || session.apiKey,
    effectiveUsername: imp.userId || session.username,
    ludusUserOverride: imp.userId ?? undefined,
  }
}

/**
 * How long we wait for a testing op to complete before declaring it stalled.
 * Proxmox snapshot/revert is typically fast (< 5 min) but can take longer on
 * large VMs or slow storage.  20 min is generous while still giving timely
 * feedback instead of silently expiring via the 30-min TTL.
 */
const TESTING_OP_MAX_AGE_MS = 20 * 60_000

/** Fire a second Ludus `PUT /testing/stop` once if the first run never flips `testingEnabled`. */
const TESTING_STOP_AUTO_RETRY_MS = 4 * 60_000
const testingStopRetriedOpIds = new Set<string>()

function forgetTestingStopRetry(opId: string) {
  testingStopRetriedOpIds.delete(opId)
}

/**
 * Check whether the active op has completed by inspecting the current Ludus
 * range state.  Updates the DB if completed.  Returns the (possibly updated) op.
 *
 * IMPORTANT: For testing-mode ops, Ludus does NOT set rangeState="DEPLOYING".
 * It fires Proxmox snapshot/revert jobs directly and rangeState stays "SUCCESS"
 * throughout.  The ONLY reliable completion signal is testingEnabled flipping
 * to the expected value (which Ludus sets only after all VM jobs finish).
 * We therefore rely on testingEnabled for success, ERROR/ABORTED for immediate
 * failure (even if DEPLOYING is still true), max-age timeout, and an optional
 * automatic retry of `testing/stop`.
 */
async function checkCompletion(
  op: ReturnType<typeof getActiveRangeOp> & object,
  effectiveApiKey: string,
  rangeId: string,
  ludusUserOverride?: string,
) {
  if (!op || op.status === "completed" || op.status === "error") return op

  // ── Max-age guard ────────────────────────────────────────────────────────
  // If the op has been running (not just pending) for longer than the allowed
  // window, declare it failed rather than waiting for the 30-min TTL to silently
  // drop it from the active query.  This surfaces an explicit "error" state in
  // the UI so the user can retry without manual PocketBase intervention.
  if (op.status === "running" && Date.now() - op.startedAt > TESTING_OP_MAX_AGE_MS) {
    forgetTestingStopRetry(op.id)
    completeRangeOp(op.id, false)
    recordLuxTestingOpTerminal(op, false, { apiKey: effectiveApiKey, userOverride: ludusUserOverride })
    return { ...op, status: "error" as const }
  }

  try {
    // ── PocketBase fast-path ─────────────────────────────────────────────────
    // PocketBase is the authoritative source for testingEnabled and rangeState.
    // Querying it directly bypasses any Ludus API caching, which is the primary
    // reason the status gets "stuck" showing the old state after an op finishes.
    const pbStatus = await fetchPbRangeStatus(rangeId)

    let rangeState: string | undefined
    let testingEnabled: boolean | undefined

    if (pbStatus) {
      rangeState    = pbStatus.rangeState    ?? undefined
      testingEnabled = pbStatus.testingEnabled ?? undefined
    } else {
      // PocketBase unavailable (root API key not set, or network error).
      // Fall back to the Ludus REST API so the poller keeps working.
      const result = await ludusRequest<{
        rangeState?: string
        testingEnabled?: boolean
      }>(`/range?rangeID=${encodeURIComponent(rangeId)}`, { apiKey: effectiveApiKey, userOverride: ludusUserOverride })

      if (!result.data) return op
      rangeState    = result.data.rangeState
      testingEnabled = result.data.testingEnabled
    }

    // Ensure the op is marked running (it should already be from POST, but
    // handle the edge case where a page refresh catches a very new op).
    if (op.status === "pending") {
      markRangeOpRunning(op.id)
      return { ...op, status: "running" as const }
    }

    // ── Primary completion signal ──────────────────────────────────────────
    // testingEnabled changed to the expected value → op succeeded.
    // We check this even while DEPLOYING so we don't miss a fast transition.
    const expectedBool = op.expectedTestingEnabled === 1
    if (testingEnabled === expectedBool) {
      forgetTestingStopRetry(op.id)
      completeRangeOp(op.id, true)
      recordLuxTestingOpTerminal(op, true, { apiKey: effectiveApiKey, userOverride: ludusUserOverride })
      return { ...op, status: "completed" as const }
    }

    // ── Hard failure ───────────────────────────────────────────────────────
    // Treat ERROR/ABORTED as terminal even while DEPLOYING — testing-mode Ansible
    // can fail mid-play (e.g. Proxmox "New-style module did not handle its own exit")
    // and Ludus may still report DEPLOYING briefly; waiting would leave the UI on
    // "Stopping…" forever with testingEnabled stuck true.
    if (rangeState === "ERROR" || rangeState === "ABORTED") {
      forgetTestingStopRetry(op.id)
      completeRangeOp(op.id, false)
      recordLuxTestingOpTerminal(op, false, { apiKey: effectiveApiKey, userOverride: ludusUserOverride })
      return { ...op, status: "error" as const }
    }

    // One automatic retry of testing/stop — covers flaky Ludus/Proxmox where the
    // first PUT returned 200 but jobs never completed.
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
        apiKey: effectiveApiKey,
        userOverride: ludusUserOverride,
        timeout: 5 * 60_000,
      }).catch(() => {})
    }

    // Still waiting — op remains running.  The poller will retry every 3 s.
  } catch {
    // Non-fatal — return op unchanged; client will retry on next poll
  }

  return op
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Housekeeping runs before auth so the table is always created on first hit,
  // even for unauthenticated requests (pruneOldRangeOps is read-only harmless).
  try { pruneOldRangeOps() } catch {}

  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const rangeId = request.nextUrl.searchParams.get("rangeId")
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const { effectiveApiKey, effectiveUsername, ludusUserOverride } = getEffective(request, session)

  // Housekeeping — fire-and-forget, never throws
  try { pruneOldRangeOps() } catch {}

  let op = getActiveRangeOp(rangeId, effectiveUsername)
  if (op) {
    op = await checkCompletion(op, effectiveApiKey, rangeId, ludusUserOverride)
  }

  return NextResponse.json({ op })
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try { pruneOldRangeOps() } catch {}
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: { rangeId?: string; opType?: string; dismissStuckOp?: boolean }
  try { body = await request.json() } catch { body = {} }

  const { rangeId, opType, dismissStuckOp } = body
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const { effectiveApiKey, effectiveUsername, ludusUserOverride } = getEffective(request, session)

  /** Clear a stuck DB op when Ludus never reported completion (user can retry or fix VMs). */
  if (dismissStuckOp === true) {
    const stuck = getActiveRangeOp(rangeId, effectiveUsername)
    if (stuck) {
      forgetTestingStopRetry(stuck.id)
      completeRangeOp(stuck.id, false)
    }
    return NextResponse.json({ op: null, dismissed: Boolean(stuck) })
  }

  if (opType !== "testing_start" && opType !== "testing_stop") {
    return NextResponse.json({ error: "opType must be testing_start or testing_stop" }, { status: 400 })
  }

  // Cancel any stale running op for this range before creating the new one.
  // This handles the case where an old op got stuck (e.g. from a bad deploy
  // or a container restart while it was in "running" state).
  const staleOp = getActiveRangeOp(rangeId, effectiveUsername)
  if (staleOp) {
    forgetTestingStopRetry(staleOp.id)
    completeRangeOp(staleOp.id, false)
  }

  // Create the DB record before calling Ludus so a page refresh immediately
  // after triggering sees the pending state.
  const op = createRangeOp(rangeId, effectiveUsername, opType as RangeOpType)

  const ludusPath = opType === "testing_start"
    ? `/testing/start?rangeID=${encodeURIComponent(rangeId)}`
    : `/testing/stop?rangeID=${encodeURIComponent(rangeId)}`

  // Use a generous timeout — Proxmox snapshot/revert can take a while to queue,
  // and on slow hardware Ludus itself may take > 30 s to acknowledge the request.
  // We give it up to 5 min before giving up on the HTTP response.
  const result = await ludusRequest(ludusPath, {
    method: "PUT",
    apiKey: effectiveApiKey,
    userOverride: ludusUserOverride,
    timeout: 5 * 60_000,
  })

  // status === 0 means OUR network timeout fired before Ludus replied.
  // In this case Ludus may have already accepted and queued the jobs but
  // simply responded slowly.  We keep the op as "running" and let the
  // 3-second checkCompletion poller detect the actual outcome via testingEnabled.
  const ludusTimedOut = result.status === 0

  if (!ludusTimedOut && result.error && result.status !== 200 && result.status !== 204) {
    // Ludus explicitly rejected the call (4xx / 5xx) — fail immediately.
    forgetTestingStopRetry(op.id)
    completeRangeOp(op.id, false)
    recordLuxTestingOpTerminal(op, false, { apiKey: effectiveApiKey, userOverride: ludusUserOverride })
    return NextResponse.json(
      { error: result.error || `Ludus returned HTTP ${result.status}` },
      { status: result.status || 500 }
    )
  }

  // Accepted (or timed out but potentially in-progress) — mark as running.
  // The client will poll GET /api/range/ops every 3 s which calls checkCompletion
  // and watches testingEnabled until it reaches the expected value.
  markRangeOpRunning(op.id)
  return NextResponse.json({ op: { ...op, status: "running" } })
}
