import { NextRequest, NextResponse } from "next/server"
import { isHttp404Error, listSources } from "@/lib/ludus-source-client"
import { requireSourcesSession } from "@/lib/ludus-sources-route-helpers"
import { logAndSafeError } from "@/lib/safe-client-error"
import { listRepoRefs } from "@/lib/template-repo-client"

export const maxDuration = 60

/** GET — list remote branches (and tags) for a registered git source URL. */
export async function GET(
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

  const includeTags = request.nextUrl.searchParams.get("tags") === "1"

  try {
    const sources = await listSources(apiKey)
    const row = sources.find((s) => (s.sourceID || s.id) === sourceId)
    if (!row) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 })
    }
    if (!row.url?.trim()) {
      return NextResponse.json({ error: "Source has no git URL" }, { status: 400 })
    }

    const refs = await listRepoRefs(row.url, { includeTags })
    return NextResponse.json({
      sourceID: sourceId,
      url: row.url,
      currentRef: row.ref || undefined,
      refs,
    })
  } catch (err) {
    if (isHttp404Error(err)) {
      return NextResponse.json(
        { error: "Sources API requires Ludus 2.2.0 or newer." },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: logAndSafeError("sources/refs", err, "Failed to list repository refs") },
      { status: 502 },
    )
  }
}
