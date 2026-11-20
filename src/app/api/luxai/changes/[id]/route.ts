import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/session/require-session"
import { ChangeStartedError, applyStoredChange, createLiveHost, luxaiActor, revertStoredChange } from "@/lib/luxai/actions"
import { logAppEvent } from "@/lib/logs/app-log"
import { addMessage, claimPending, getChangeForUser, markChange, noteAppliedOutput, sessionOwned, setChangeAfterText, settleClaim } from "@/lib/luxai/store"
import { prepareUploadedYaml } from "@/lib/luxai/tools"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const { id } = await context.params
  const actor = await luxaiActor(gate.session, request)
  const change = getChangeForUser(actor.username, id)
  if (!change || !sessionOwned(actor.username, change.sessionId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const body = await request.json().catch(() => null)
  const action = body && typeof body === "object" ? (body as { action?: string }).action : ""
  const host = createLiveHost(gate.session, request)

  if (action === "reject") {
    if (!markChange(id, actor.username, "rejected")) {
      return NextResponse.json({ error: "That proposal is no longer pending." }, { status: 409 })
    }
    addMessage(change.sessionId, "assistant", `The operator rejected proposal ${id}. Nothing was changed.`)
    return NextResponse.json({ ok: true, status: "rejected" })
  }

  if (action === "apply") {
    const edited = body && typeof body === "object" && typeof (body as { yaml?: unknown }).yaml === "string"
      ? (body as { yaml: string }).yaml
      : undefined
    let afterText = change.afterText
    if (edited !== undefined && (change.kind === "range_config" || change.kind === "range_create")) {
      try {
        afterText = editedRangeAfter(change.kind, change.afterText, edited)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Range config was refused."
        return NextResponse.json({ error: message }, { status: 400 })
      }
    }
    if (!claimPending(id, actor.username)) {
      return NextResponse.json({ error: "That proposal is no longer pending." }, { status: 409 })
    }
    if (afterText !== change.afterText) setChangeAfterText(actor.username, id, afterText)
    try {
      const detail = await applyStoredChange(
        change.kind,
        change.rangeId,
        change.beforeText,
        afterText,
        host,
        actor.apiKey,
      )
      settleClaim(id, actor.username, "applied")
      if (change.kind === "guest_command") noteAppliedOutput(id, actor.username, detail)
      logAppEvent("luxai_apply", `${change.kind} ${change.rangeId}`, {
        username: actor.username,
        outcome: "success",
      })
      addMessage(change.sessionId, "assistant", `The operator applied proposal ${id}. ${detail}`)
      const navigate = deployLanding(change.kind, change.rangeId, afterText, detail)
      return NextResponse.json({ ok: true, status: "applied", detail, ...(navigate ? { navigate } : {}) })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apply failed."
      if (err instanceof ChangeStartedError && !err.retryable) {
        settleClaim(id, actor.username, "applied")
        noteAppliedOutput(id, actor.username, message)
        addMessage(change.sessionId, "assistant", `Proposal ${id} was sent and then failed. It will not be sent again. ${message}`)
        return NextResponse.json({ error: message.slice(0, 500), status: "applied" }, { status: 502 })
      }
      if (err instanceof ChangeStartedError) {
        settleClaim(id, actor.username, "pending")
        logAppEvent("luxai_apply", `${change.kind} ${change.rangeId}`, {
          username: actor.username,
          outcome: "failure",
        })
        addMessage(change.sessionId, "assistant", `Proposal ${id} did not finish. Apply it again. ${message}`)
        return NextResponse.json({ error: message.slice(0, 500) }, { status: 502 })
      }
      settleClaim(id, actor.username, "pending")
      logAppEvent("luxai_apply", `${change.kind} ${change.rangeId}`, {
        username: actor.username,
        outcome: "failure",
      })
      return NextResponse.json({ error: message.slice(0, 500) }, { status: 502 })
    }
  }

  if (action === "revert") {
    if (change.status !== "applied") {
      return NextResponse.json({ error: "Only an applied change can be reverted." }, { status: 409 })
    }
    try {
      const detail = await revertStoredChange(
        change.kind,
        change.rangeId,
        change.beforeText,
        change.afterText,
        host,
        actor.apiKey,
      )
      if (!markChange(id, actor.username, "reverted")) {
        return NextResponse.json({ error: "That change was not applied." }, { status: 409 })
      }
      logAppEvent("luxai_revert", `${change.kind} ${change.rangeId}`, {
        username: actor.username,
        outcome: "success",
      })
      addMessage(change.sessionId, "assistant", `The operator reverted proposal ${id}. ${detail}`)
      return NextResponse.json({ ok: true, status: "reverted", detail })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Revert failed."
      return NextResponse.json({ error: message.slice(0, 500) }, { status: 502 })
    }
  }

  return NextResponse.json({ error: "Action must be apply, revert, or reject." }, { status: 400 })
}

function deployLanding(
  kind: string,
  rangeId: string,
  afterText: string,
  detail: string,
): { href: string; rangeId: string } | undefined {
  if (kind === "deploy") return { href: "/", rangeId }
  if (kind === "range_create") {
    try {
      const spec = JSON.parse(afterText) as { deploy?: boolean; rangeId?: string }
      if (spec.deploy === true) return { href: "/", rangeId: spec.rangeId || rangeId }
    } catch { /* a create that did not deploy stays in the chat */ }
    return undefined
  }
  if (kind !== "goad_deploy") return undefined
  const task = detail.match(/task (goad-[\w.-]+)/)?.[1]
  if (!task) return undefined
  let lab = ""
  let target = rangeId
  try {
    const spec = JSON.parse(afterText) as { lab?: string; create?: { rangeId?: string } | null }
    lab = typeof spec.lab === "string" ? spec.lab : ""
    target = spec.create?.rangeId || rangeId
  } catch { /* the change already names the range */ }
  const query = new URLSearchParams({ luxaiTask: task, rangeId: target })
  if (lab) query.set("lab", lab)
  return { href: `/goad/new?${query.toString()}`, rangeId: target }
}

function editedRangeAfter(kind: string, stored: string, edited: string): string {
  const yaml = prepareUploadedYaml(edited)
  if (kind === "range_config") return yaml
  const spec = JSON.parse(stored) as { name?: string; rangeId?: string; yaml?: string }
  spec.yaml = yaml
  return JSON.stringify(spec)
}
