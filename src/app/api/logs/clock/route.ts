import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/require-session"
import { listDeployLogClocks, pruneDeployLogClocks } from "@/lib/deploy-log-clock-store"

export async function GET(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response

  const rangeId = request.nextUrl.searchParams.get("rangeId")?.trim() ?? ""
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(rangeId)) {
    return NextResponse.json({ error: "rangeId required" }, { status: 400 })
  }

  try {
    pruneDeployLogClocks()
  } catch {
    /* a failed prune still returns the rows */
  }

  const generations = listDeployLogClocks(rangeId).map((generation) => ({
    id: generation.id,
    entries: generation.entries,
  }))
  return NextResponse.json({ generations })
}
