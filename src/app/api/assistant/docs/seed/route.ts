import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { docsCorpusStats, seedLudusDocsCache } from "@/lib/assistant/docs-corpus"

/** Admin: seed / refresh cached Ludus docs from docs.ludus.cloud */
export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (!session.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { force?: boolean } | null
  const result = await seedLudusDocsCache({ force: !!body?.force })
  return NextResponse.json({ ...result, corpus: docsCorpusStats() })
}

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (!session.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 })
  return NextResponse.json(docsCorpusStats())
}
