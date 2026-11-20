import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/session/require-session"
import { luxaiActor } from "@/lib/luxai/actions"
import { formRecord } from "@/lib/luxai/form-record"
import { addMessage, readRun, runFormSource, setRunAnswer, setRunStatus, setRunSteer } from "@/lib/luxai/store"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const { id } = await context.params
  const actor = await luxaiActor(gate.session, request)
  const run = readRun(actor.username, id)
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const body = await request.json().catch(() => null)
  const action = body && typeof body === "object" ? (body as { action?: string; text?: string }).action : ""
  const text = body && typeof body === "object" && typeof (body as { text?: string }).text === "string"
    ? (body as { text: string }).text.trim()
    : ""

  if (action === "pause") {
    if (run.status !== "running" || !setRunStatus(actor.username, id, "paused")) {
      return NextResponse.json({ error: "This answer is not running." }, { status: 409 })
    }
    return NextResponse.json({ ok: true, status: "paused" })
  }
  if (action === "resume") {
    if (run.status !== "paused" || !setRunStatus(actor.username, id, "running")) {
      return NextResponse.json({ error: "This answer is not paused." }, { status: 409 })
    }
    return NextResponse.json({ ok: true, status: "running" })
  }
  if (action === "stop") {
    if ((run.status !== "running" && run.status !== "paused") || !setRunStatus(actor.username, id, "stopped")) {
      return NextResponse.json({ error: "This answer is already finished." }, { status: 409 })
    }
    return NextResponse.json({ ok: true, status: "stopped" })
  }
  if (action === "answer") {
    const choiceId = body && typeof body === "object" && typeof (body as { choiceId?: string }).choiceId === "string"
      ? (body as { choiceId: string }).choiceId.trim()
      : ""
    const selected = body && typeof body === "object" && Array.isArray((body as { selected?: unknown }).selected)
      ? (body as { selected: unknown[] }).selected.filter((item): item is string => typeof item === "string").slice(0, 32)
      : []
    if (!choiceId) return NextResponse.json({ error: "Choice id is missing." }, { status: 400 })
    if (run.status !== "running" && run.status !== "paused") {
      return NextResponse.json({ error: "This answer is not in progress." }, { status: 409 })
    }
    const rawValues = body && typeof body === "object" ? (body as { values?: unknown }).values : null
    const values: Record<string, string> = {}
    if (rawValues && typeof rawValues === "object" && !Array.isArray(rawValues)) {
      for (const [key, value] of Object.entries(rawValues).slice(0, 32)) {
        if (typeof value === "string" && key.length <= 64 && value.length <= 12_000) values[key] = value.trim()
      }
    }
    const source = runFormSource(actor.username, id)
    if (source?.choice && source.choice.id === choiceId) {
      addMessage(source.sessionId, "user", formRecord(source.choice, selected, values))
    }
    if (!setRunAnswer(actor.username, id, JSON.stringify({ choiceId, selected, values }))) {
      return NextResponse.json({ error: "This answer is not in progress." }, { status: 409 })
    }
    return NextResponse.json({ ok: true, status: run.status })
  }
  if (action === "steer") {
    if (!text) return NextResponse.json({ error: "Steer text is empty." }, { status: 400 })
    if (text.length > 8_000) return NextResponse.json({ error: "Steer text is too long." }, { status: 400 })
    if (!setRunSteer(actor.username, id, text)) {
      return NextResponse.json({ error: "This answer is not in progress." }, { status: 409 })
    }
    if (run.status === "paused") setRunStatus(actor.username, id, "running")
    return NextResponse.json({ ok: true, status: "running" })
  }
  return NextResponse.json({ error: "Action must be pause, resume, stop, steer, or answer." }, { status: 400 })
}
