import { NextRequest, NextResponse } from "next/server"
import { effectiveScopeTagFromSession } from "@/lib/session/effective-scope"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"
import { revalidateAfterSourceMutation } from "@/lib/ludus/ludus-cache-revalidate"
import { isHttp404Error, syncSource } from "@/lib/sources/ludus-source-client"
import { requireSourcesSession } from "@/lib/ludus/ludus-sources-route-helpers"
import { liveSessionIsAdmin } from "@/lib/session/session-admin-check"
import { logAndSafeError } from "@/lib/ui/safe-client-error"

export const maxDuration = 300

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

  // `--global` installs roles and collections for every user. Ludus allows that for admins only.
  if (options.globalRoles && !(await liveSessionIsAdmin(session))) {
    options = { ...options, globalRoles: false }
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
