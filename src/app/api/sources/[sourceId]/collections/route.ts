import { NextRequest, NextResponse } from "next/server"
import { isHttp404Error } from "@/lib/ludus-source-client"
import { resolveSourceCollections } from "@/lib/source-catalog-resolver"
import { requireSourcesSession } from "@/lib/ludus-sources-route-helpers"
import { logAndSafeError } from "@/lib/safe-client-error"

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

  try {
    const { items, catalogSource } = await resolveSourceCollections(apiKey, sourceId)
    return NextResponse.json({ collections: items, catalogSource })
  } catch (err) {
    if (isHttp404Error(err)) {
      return NextResponse.json(
        { error: "Sources API requires Ludus 2.2.0 or newer." },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: logAndSafeError("sources/collections", err, "Failed to list collections") },
      { status: 502 },
    )
  }
}
