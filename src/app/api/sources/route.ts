import { NextRequest, NextResponse } from "next/server"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { revalidateAfterSourceMutation } from "@/lib/ludus-cache-revalidate"
import { createGitSource, isHttp404Error, listSources } from "@/lib/ludus-source-client"
import { requireSourcesSession } from "@/lib/ludus-sources-route-helpers"
import { assertSafeTemplateRepoUrl } from "@/lib/safe-template-repo-url"
import { logAndSafeError } from "@/lib/safe-client-error"

export const maxDuration = 120

export async function GET(request: NextRequest) {
  const { session, apiKey } = await requireSourcesSession(request)
  if (!session || !apiKey) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const sources = await listSources(apiKey)
    return NextResponse.json({ sources, available: true })
  } catch (err) {
    if (isHttp404Error(err)) {
      return NextResponse.json({ sources: [], available: false })
    }
    return NextResponse.json(
      { error: logAndSafeError("sources/list", err, "Failed to list sources") },
      { status: 502 },
    )
  }
}

export async function POST(request: NextRequest) {
  const { session, apiKey } = await requireSourcesSession(request)
  if (!session || !apiKey) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { url?: string; ref?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const url = body.url?.trim()
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 })
  }

  const safe = assertSafeTemplateRepoUrl(url)
  if (!safe.ok) {
    return NextResponse.json({ error: safe.error }, { status: 400 })
  }

  const ref = body.ref?.trim() || "main"

  try {
    const sourceID = await createGitSource(apiKey, url, ref)
    const scopeTag = effectiveScopeTagFromSession(session)
    revalidateAfterSourceMutation(scopeTag)
    logLuxRouteAction(request, session, { outcome: "success", detail: `source=${sourceID}` })
    return NextResponse.json({ sourceID, message: "Source registered" })
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "create-source" })
    if (isHttp404Error(err)) {
      return NextResponse.json(
        { error: "Sources API requires Ludus 2.2.0 or newer." },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: logAndSafeError("sources/create", err, "Failed to register source") },
      { status: 502 },
    )
  }
}
