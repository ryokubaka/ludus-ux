import { NextRequest, NextResponse } from "next/server"
import { fetchSharePickerDirectory } from "@/lib/ludus-share-picker-server"
import { resolveSession } from "@/lib/session"

/** GET /api/ludus/share-picker — Ludus users + groups for share dialogs (any authenticated user). */
export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const directory = await fetchSharePickerDirectory(session)
  return NextResponse.json(directory)
}
