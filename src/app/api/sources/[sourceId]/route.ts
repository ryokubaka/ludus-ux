import { NextRequest, NextResponse } from "next/server"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { revalidateAfterSourceMutation } from "@/lib/ludus-cache-revalidate"
import {
  changeGitSourceRef,
  deleteSource,
  isHttp404Error,
  updateGitSource,
} from "@/lib/ludus-source-client"
import { requireSourcesSession } from "@/lib/ludus-sources-route-helpers"
import { logAndSafeError } from "@/lib/safe-client-error"

export const maxDuration = 120

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { session, apiKey } = await requireSourcesSession(request)
  if (!session || !apiKey) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { sourceId } = await params
  if (!sourceId?.trim()) {
    return NextResponse.json({ error: "sourceId is required" }, { status: 400 })
  }

  let body: { ref?: string; url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const ref = body.ref?.trim()
  const url = body.url?.trim()
  if (!ref && !url) {
    return NextResponse.json({ error: "ref or url is required" }, { status: 400 })
  }

  try {
    // Ref changes: re-register (Ludus single-branch clones break on PATCH+checkout).
    if (ref && !url) {
      const result = await changeGitSourceRef(apiKey, sourceId, ref)
      const scopeTag = effectiveScopeTagFromSession(session)
      revalidateAfterSourceMutation(scopeTag)
      logLuxRouteAction(request, session, {
        outcome: "success",
        detail: `update-source=${sourceId}->${result.sourceID} ref=${result.ref} recreated=${result.recreated}`,
      })
      return NextResponse.json({
        status: result.recreated ? "recreated" : "unchanged",
        sourceID: result.sourceID,
        previousSourceID: sourceId,
        recreated: result.recreated,
        ref: result.ref,
      })
    }

    await updateGitSource(apiKey, sourceId, { ref, url })
    const scopeTag = effectiveScopeTagFromSession(session)
    revalidateAfterSourceMutation(scopeTag)
    logLuxRouteAction(request, session, {
      outcome: "success",
      detail: `update-source=${sourceId} ref=${ref || ""}`,
    })
    return NextResponse.json({ status: "updated", sourceID: sourceId, ref: ref || undefined })
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: `update-source=${sourceId}` })
    if (isHttp404Error(err)) {
      return NextResponse.json(
        { error: "Sources API requires Ludus 2.2.0 or newer." },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: logAndSafeError("sources/update", err, "Failed to update source") },
      { status: 502 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { session, apiKey } = await requireSourcesSession(request)
  if (!session || !apiKey) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { sourceId } = await params
  if (!sourceId?.trim()) {
    return NextResponse.json({ error: "sourceId is required" }, { status: 400 })
  }

  let purge = false
  try {
    const body = await request.json()
    purge = body?.purge === true
  } catch {
    // empty body ok
  }

  try {
    await deleteSource(apiKey, sourceId, purge)
    const scopeTag = effectiveScopeTagFromSession(session)
    revalidateAfterSourceMutation(scopeTag)
    logLuxRouteAction(request, session, {
      outcome: "success",
      detail: `delete-source=${sourceId} purge=${purge}`,
    })
    return NextResponse.json({ status: "deleted" })
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: `delete-source=${sourceId}` })
    if (isHttp404Error(err)) {
      return NextResponse.json(
        { error: "Sources API requires Ludus 2.2.0 or newer." },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: logAndSafeError("sources/delete", err, "Failed to delete source") },
      { status: 502 },
    )
  }
}
