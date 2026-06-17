import { NextRequest, NextResponse } from "next/server"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { revalidateLudusResource, revalidateLudusScopeResource } from "@/lib/ludus-cache-revalidate"
import { isHttp404Error, syncSource } from "@/lib/ludus-source-client"
import { requireSourcesSession } from "@/lib/ludus-sources-route-helpers"
import { logAndSafeError } from "@/lib/safe-client-error"

export const maxDuration = 300

function revalidateAfterSourceMutation(scopeTag: string) {
  revalidateLudusResource("templates")
  revalidateLudusResource("blueprints")
  revalidateLudusResource("ansible")
  revalidateLudusScopeResource(scopeTag, "templates")
  revalidateLudusScopeResource(scopeTag, "blueprints")
  revalidateLudusScopeResource(scopeTag, "ansible")
}

export async function POST(
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

  let options: { globalRoles?: boolean; force?: boolean; dryRun?: boolean } = {}
  try {
    options = (await request.json()) ?? {}
  } catch {
    // empty body ok
  }

  try {
    const result = await syncSource(apiKey, sourceId, options)
    const scopeTag = effectiveScopeTagFromSession(session)
    revalidateAfterSourceMutation(scopeTag)
    logLuxRouteAction(request, session, { outcome: "success", detail: `sync-source=${sourceId}` })
    return NextResponse.json({ result })
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: `sync-source=${sourceId}` })
    if (isHttp404Error(err)) {
      return NextResponse.json(
        { error: "Sources API requires Ludus 2.2.0 or newer." },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: logAndSafeError("sources/sync", err, "Source sync failed") },
      { status: 502 },
    )
  }
}
