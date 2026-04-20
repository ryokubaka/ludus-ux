/**
 * POST /api/range/abort — unified abort for Ludus ranges (with or without GOAD).
 *
 * Replaces the old `/api/range/force-state` split-brain design. One request
 * handles three concerns so the user never has to chase the state themselves:
 *
 *   1. Kill any in-flight GOAD SSH/ansible task for this range so it stops
 *      pushing work at Ludus the moment the user clicks Abort.
 *   2. Ask Ludus to abort the deployment (user key, then admin/root fallback).
 *   3. Poll `rangeState` for up to 10 s. If Ludus's deploy goroutine has
 *      already exited without flipping state away from `DEPLOYING`/`WAITING`,
 *      write `rangeState = ABORTED` directly to PocketBase as a last resort.
 *      This eliminates the "I always have to mark it ERROR manually" pain
 *      point from the old flow.
 *
 * Body: {
 *   rangeId: string
 *   goadInstanceId?: string   // optional — kill any running task for this instance
 *   goadTaskId?: string       // optional — kill this specific task (takes precedence)
 *   apiKey?: string           // optional — effective (possibly impersonated) key
 * }
 *
 * Response (always 200 unless the PB admin token itself is misconfigured):
 *   {
 *     success: true,
 *     goadKilled: string[],       // ids of tasks the cleanup registry killed
 *     goadMarkedAborted: string[],// ids we flipped to "aborted" in SQLite
 *     ludusAborted: boolean,      // Ludus /range/abort returned 2xx
 *     method: "user-abort" | "admin-abort" | "none"
 *     pbForced: boolean,          // we PATCHed PocketBase rangeState directly
 *     finalState?: string         // last Ludus rangeState we observed
 *   }
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { getSettings } from "@/lib/settings-store"
import { invokeCleanup } from "@/lib/task-cleanup-registry"
import { abortTask, getRunningTasksForInstance } from "@/lib/goad-task-store"
import { setPbRangeState } from "@/lib/pocketbase-client"
import type { RangeObject } from "@/lib/types"

export const dynamic = "force-dynamic"

/** Terminal Ludus range states — reaching any of these means the abort landed. */
const TERMINAL_STATES = new Set([
  "ABORTED",
  "ERROR",
  "SUCCESS",
  "DESTROYED",
  "NEVER DEPLOYED",
])

const POLL_INTERVAL_MS = 1_000
const POLL_BUDGET_MS = 10_000

async function tryAbort(
  rangeId: string,
  apiKey: string,
  useAdmin: boolean,
): Promise<boolean> {
  try {
    const result = await ludusRequest(
      `/range/abort?rangeID=${encodeURIComponent(rangeId)}`,
      { method: "POST", apiKey, useAdminEndpoint: useAdmin },
    )
    return result.status >= 200 && result.status < 300
  } catch {
    return false
  }
}

async function readRangeState(
  rangeId: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const res = await ludusRequest<RangeObject>(
      `/range?rangeID=${encodeURIComponent(rangeId)}`,
      { method: "GET", apiKey },
    )
    if (res.status < 200 || res.status >= 300) return null
    return (res.data?.rangeState || "").toString().toUpperCase() || null
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: {
    rangeId?: string
    goadInstanceId?: string
    goadTaskId?: string
    apiKey?: string
  }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const { rangeId, goadInstanceId, goadTaskId, apiKey: bodyApiKey } = body
  if (!rangeId) {
    return NextResponse.json({ error: "rangeId required" }, { status: 400 })
  }

  // Resolve effective API key (supports admin-as-user impersonation headers,
  // matching the old force-state behavior).
  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = bodyApiKey || impersonateApiKey || session.apiKey

  // ── 1. Kill any in-flight GOAD task for this range ────────────────────────
  // Best-effort: we never fail the overall abort because the GOAD kill step
  // couldn't find a task. Non-GOAD ranges simply skip this step entirely
  // (no goadTaskId + no running task for goadInstanceId).
  const goadKilled: string[] = []
  const goadMarkedAborted: string[] = []

  const taskIdsToKill: string[] = []
  if (goadTaskId) {
    taskIdsToKill.push(goadTaskId)
  } else if (goadInstanceId) {
    for (const t of getRunningTasksForInstance(goadInstanceId)) {
      taskIdsToKill.push(t.id)
    }
  }

  for (const id of taskIdsToKill) {
    try {
      if (invokeCleanup(id)) goadKilled.push(id)
      // abortTask is idempotent: it's a no-op if the task already reached a
      // terminal state, so safe to call even when invokeCleanup returned false.
      abortTask(id)
      goadMarkedAborted.push(id)
    } catch {
      // Keep going — we still want Ludus abort + PB reconcile to run.
    }
  }

  // ── 2. Ask Ludus to abort ────────────────────────────────────────────────
  let ludusAborted = false
  let method: "user-abort" | "admin-abort" | "none" = "none"

  if (await tryAbort(rangeId, effectiveApiKey, false)) {
    ludusAborted = true
    method = "user-abort"
  } else {
    const settings = getSettings()
    if (settings.rootApiKey && (await tryAbort(rangeId, settings.rootApiKey, true))) {
      ludusAborted = true
      method = "admin-abort"
    }
  }

  // ── 3. Poll rangeState + reconcile via PocketBase if stuck ───────────────
  // Even when Ludus accepted the abort (2xx), its deploy goroutine sometimes
  // finishes its own teardown before flipping the state, so we always poll.
  let finalState: string | null = await readRangeState(rangeId, effectiveApiKey)
  const deadline = Date.now() + POLL_BUDGET_MS
  while (
    finalState &&
    !TERMINAL_STATES.has(finalState) &&
    Date.now() < deadline
  ) {
    await sleep(POLL_INTERVAL_MS)
    finalState = await readRangeState(rangeId, effectiveApiKey)
  }

  let pbForced = false
  let pbError: string | null = null
  if (!finalState || !TERMINAL_STATES.has(finalState)) {
    // Either we couldn't read state at all (Ludus unreachable) or it's still
    // DEPLOYING/WAITING. Write ABORTED directly to PB so the user doesn't have
    // to dig into the admin console to unblock themselves.
    pbError = await setPbRangeState(rangeId, "ABORTED")
    if (!pbError) {
      pbForced = true
      finalState = "ABORTED"
    }
  }

  if (!ludusAborted && !pbForced) {
    // Rare case: Ludus refused abort AND PocketBase write failed. Surface the
    // reason so the UI can toast something actionable.
    return NextResponse.json(
      {
        success: false,
        goadKilled,
        goadMarkedAborted,
        ludusAborted,
        method,
        pbForced,
        finalState,
        error: pbError || "Unable to abort the range via Ludus or PocketBase.",
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    success: true,
    goadKilled,
    goadMarkedAborted,
    ludusAborted,
    method,
    pbForced,
    finalState,
  })
}
