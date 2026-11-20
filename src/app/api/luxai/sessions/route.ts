import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/session/require-session"
import { luxaiActor } from "@/lib/luxai/actions"
import { listSessions } from "@/lib/luxai/store"

export async function GET(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const actor = await luxaiActor(gate.session, request)
  return NextResponse.json({ sessions: listSessions(actor.username) })
}
