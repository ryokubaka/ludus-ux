import { NextRequest, NextResponse } from "next/server"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { revalidateLudusResource, revalidateLudusScopeResource } from "@/lib/ludus-cache-revalidate"
import { deleteSource, isHttp404Error } from "@/lib/ludus-source-client"
import { requireSourcesSession } from "@/lib/ludus-sources-route-helpers"
import { logAndSafeError } from "@/lib/safe-client-error"

export const maxDuration = 120

function revalidateAfterSourceMutation(scopeTag: string) {
  revalidateLudusResource("templates")
  revalidateLudusResource("blueprints")
  revalidateLudusResource("ansible")
  revalidateLudusScopeResource(scopeTag, "templates")
  revalidateLudusScopeResource(scopeTag, "blueprints")
  revalidateLudusScopeResource(scopeTag, "ansible")
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
