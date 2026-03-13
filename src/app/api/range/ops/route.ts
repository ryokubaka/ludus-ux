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
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import {
  createRangeOp,
  getActiveRangeOp,
  markRangeOpRunning,
  completeRangeOp,
  pruneOldRangeOps,
  type RangeOpType,
} from "@/lib/range-op-store"

// Remove the bare getDb() call — it was being tree-shaken by webpack.
// Schema creation is handled inside each exported store function instead.

/** Resolve impersonation headers and return { effectiveApiKey, effectiveUsername }. */
function getEffective(request: NextRequest, session: { apiKey: string; username: string; isAdmin: boolean }) {
  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const impersonateAs = session.isAdmin
    ? request.headers.get("X-Impersonate-As") || null
    : null
  return {
    effectiveApiKey:   impersonateApiKey || session.apiKey,
    effectiveUsername: impersonateAs     || session.username,
  }
}

/**
 * Check whether the active op has completed by inspecting the current Ludus
 * range state.  Updates the DB if completed.  Returns the (possibly updated) op.
 *
 * IMPORTANT: For testing-mode ops, Ludus does NOT set rangeState="DEPLOYING".
 * It fires Proxmox snapshot/revert jobs directly and rangeState stays "SUCCESS"
 * throughout.  The ONLY reliable completion signal is testingEnabled flipping
 * to the expected value (which Ludus sets only after all VM jobs finish).
 * We therefore never use rangeState to declare an op "done" unless the range
 * itself has entered an ERROR or ABORTED state.
 */
async function checkCompletion(
  op: ReturnType<typeof getActiveRangeOp> & object,
  effectiveApiKey: string,
  rangeId: string,
) {
  if (!op || op.status === "completed" || op.status === "error") return op

  try {
    const result = await ludusRequest<{
      rangeState?: string
      testingEnabled?: boolean
    }>(`/range?rangeID=${encodeURIComponent(rangeId)}`, { apiKey: effectiveApiKey })

    if (!result.data) return op

    const { rangeState, testingEnabled } = result.data
    const isDeploying = rangeState === "DEPLOYING" || rangeState === "WAITING"

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
      completeRangeOp(op.id, true)
      return { ...op, status: "completed" as const }
    }

    // ── Hard failure ───────────────────────────────────────────────────────
    // Ludus entered an error state — nothing more we can do.
    if (!isDeploying && (rangeState === "ERROR" || rangeState === "ABORTED")) {
      completeRangeOp(op.id, false)
      return { ...op, status: "error" as const }
    }

    // Still waiting — op remains running.  The 30-min TTL in getActiveRangeOp
    // acts as the final safety net if the operation never completes.
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

  const { effectiveApiKey, effectiveUsername } = getEffective(request, session)

  // Housekeeping — fire-and-forget, never throws
  try { pruneOldRangeOps() } catch {}

  let op = getActiveRangeOp(rangeId, effectiveUsername)
  if (op) {
    op = await checkCompletion(op, effectiveApiKey, rangeId)
  }

  return NextResponse.json({ op })
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try { pruneOldRangeOps() } catch {}
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let body: { rangeId?: string; opType?: string }
  try { body = await request.json() } catch { body = {} }

  const { rangeId, opType } = body
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })
  if (opType !== "testing_start" && opType !== "testing_stop") {
    return NextResponse.json({ error: "opType must be testing_start or testing_stop" }, { status: 400 })
  }

  const { effectiveApiKey, effectiveUsername } = getEffective(request, session)

  // Cancel any stale running op for this range before creating the new one.
  // This handles the case where an old op got stuck (e.g. from a bad deploy
  // or a container restart while it was in "running" state).
  const staleOp = getActiveRangeOp(rangeId, effectiveUsername)
  if (staleOp) completeRangeOp(staleOp.id, false)

  // Create the DB record before calling Ludus so a page refresh immediately
  // after triggering sees the pending state.
  const op = createRangeOp(rangeId, effectiveUsername, opType as RangeOpType)

  const ludusPath = opType === "testing_start"
    ? `/testing/start?rangeID=${encodeURIComponent(rangeId)}`
    : `/testing/stop?rangeID=${encodeURIComponent(rangeId)}`
  const result = await ludusRequest(ludusPath, {
    method: "PUT",
    apiKey: effectiveApiKey,
  })

  if (result.error && result.status !== 200 && result.status !== 204) {
    // Ludus rejected the call — mark op as error so the UI doesn't get stuck
    completeRangeOp(op.id, false)
    return NextResponse.json(
      { error: result.error || `Ludus returned HTTP ${result.status}` },
      { status: result.status || 500 }
    )
  }

  // Mark as running — Ludus accepted the request
  markRangeOpRunning(op.id)
  return NextResponse.json({ op: { ...op, status: "running" } })
}
