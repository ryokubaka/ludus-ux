import { NextRequest, NextResponse } from "next/server"
import { fetchSharePickerDirectory } from "@/lib/ludus-share-picker-server"
import { requireSession } from "@/lib/require-session"

/** GET /api/ludus/share-picker — Ludus users + groups for share dialogs (any authenticated user). */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request)
  if (!auth.ok) return auth.response

  const directory = await fetchSharePickerDirectory(auth.session)
  return NextResponse.json(directory)
}
