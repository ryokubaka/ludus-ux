import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/session/require-session"
import { luxaiActor } from "@/lib/luxai/actions"
import { activeRun, deleteSession, listChanges, listMessages, renameSession, sessionOwned, setSessionArchived } from "@/lib/luxai/store"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const { id } = await context.params
  const actor = await luxaiActor(gate.session, request)
  if (!sessionOwned(actor.username, id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({
    messages: listMessages(id),
    changes: listChanges(actor.username, id),
    run: activeRun(actor.username, id),
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const { id } = await context.params
  const actor = await luxaiActor(gate.session, request)
  if (!sessionOwned(actor.username, id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const body = await request.json().catch(() => null)
  const action = body && typeof body === "object" ? (body as { action?: string }).action : ""
  if (action === "rename") {
    const title = body && typeof body === "object" && typeof (body as { title?: unknown }).title === "string"
      ? (body as { title: string }).title
      : ""
    if (!title.trim()) return NextResponse.json({ error: "A chat name is required." }, { status: 400 })
    const next = renameSession(actor.username, id, title)
    if (!next) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ ok: true, title: next })
  }
  if (action !== "archive" && action !== "restore") {
    return NextResponse.json({ error: "Action must be rename, archive, or restore." }, { status: 400 })
  }
  if (!setSessionArchived(actor.username, id, action === "archive")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, archived: action === "archive" })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const { id } = await context.params
  const actor = await luxaiActor(gate.session, request)
  if (!deleteSession(actor.username, id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
