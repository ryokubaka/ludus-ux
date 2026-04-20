/**
 * @deprecated — kept as a back-compat shim that forwards to the unified
 * `POST /api/range/abort` route. The new route kills any in-flight GOAD task,
 * attempts Ludus abort (user key → root admin), and reconciles PocketBase
 * directly when Ludus's deploy goroutine has already exited without flipping
 * `rangeState`.
 *
 * Existing callers that POST to /api/range/force-state will keep working
 * unchanged. Once grep shows no in-tree callers, this file can be deleted.
 */

import { NextRequest } from "next/server"
import { POST as abortPost } from "../abort/route"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  // Buffer the body so we can hand a fresh request to the new route without
  // streaming + duplex concerns. The old force-state body shape ({ rangeId,
  // apiKey }) is a strict subset of the new route's body shape so no
  // transformation is required.
  const rawBody = await request.text()

  const forwarded = new NextRequest(new URL("/api/range/abort", request.url), {
    method: "POST",
    headers: request.headers,
    body: rawBody,
  })
  return abortPost(forwarded)
}
