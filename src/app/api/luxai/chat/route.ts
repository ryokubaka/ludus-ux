import { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireSession } from "@/lib/session/require-session"
import { getInstanceIdForRange } from "@/lib/goad/goad-instance-range-store"
import { extractArray } from "@/lib/core/utils"
import { normalizeBlueprintList } from "@/lib/blueprints/blueprint-list-normalize"
import { ludusGet } from "@/lib/ludus/ludus-client"
import { discoverGoadCatalog, isGoadConfigured } from "@/lib/goad/goad-ssh"
import { prepareModelUrl, defaultAddressLookup } from "@/lib/luxai/endpoint-policy"
import { runLuxaiAgent } from "@/lib/luxai/agent"
import { createLiveHost, luxaiActor } from "@/lib/luxai/actions"
import { LUXAI_LIMITS } from "@/lib/luxai/defaults"
import { askHowToBuildRange, offerGoadDeploy } from "@/lib/luxai/goad-offer"
import { matchGoadDeployRequest, matchOpenRangeRequest, type GoadPlanCatalog } from "@/lib/luxai/goad-plan"
import { isResumeQuestion } from "@/lib/luxai/resume"
import type { RangeRuleDraft, RangeTemplateChoice } from "@/lib/luxai/range-vms"
import {
  addMessage,
  createRunIfIdle,
  createSession,
  getLuxaiSettings,
  insertChange,
  listMessages,
  luxaiReady,
  readRun,
  sessionOwned,
  setRunChoice,
  setRunStatus,
  takeRunAnswer,
  takeRunSteer,
} from "@/lib/luxai/store"
import type { LuxaiStreamEvent } from "@/lib/luxai/types"

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const gate = await requireSession(request)
  if (!gate.ok) return gate.response
  const settings = getLuxaiSettings()
  if (!luxaiReady(settings)) {
    return NextResponse.json(
      { error: "LUXAI is off or incomplete. An admin turns it on from the LUXAI page." },
      { status: 409 },
    )
  }
  const body = await request.json().catch(() => null)
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {}
  const question = typeof record.question === "string" ? record.question.trim() : ""
  if (!question) return NextResponse.json({ error: "Question is empty." }, { status: 400 })
  if (question.length > LUXAI_LIMITS.questionMax) {
    return NextResponse.json({ error: "Question is too long." }, { status: 400 })
  }
  let modelUrl = settings.baseUrl
  try {
    modelUrl = await prepareModelUrl(settings.baseUrl, settings.egress, defaultAddressLookup)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Model URL was refused."
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const actor = await luxaiActor(gate.session, request)
  const requested = typeof record.sessionId === "string" ? record.sessionId : ""
  let sessionId = requested
  if (sessionId) {
    if (!sessionOwned(actor.username, sessionId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
  } else {
    sessionId = createSession(actor.username, question).id
  }
  const runId = createRunIfIdle(sessionId, actor.username)
  if (!runId) {
    return NextResponse.json(
      { error: "This chat is already running. Pause, stop, steer, or interrupt that one. Another chat can run at the same time." },
      { status: 409 },
    )
  }
  addMessage(sessionId, "user", question)
  const history = listMessages(sessionId).slice(0, -1)

  const encoder = new TextEncoder()
  const host = createLiveHost(gate.session, request)
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event: LuxaiStreamEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          closed = true
        }
      }
      send({ type: "session", sessionId })
      send({ type: "run", runId })
      try {
        const resume = isResumeQuestion(question)
        const intent = resume ? null : matchGoadDeployRequest(question)
        const openRange = !resume && !intent && matchOpenRangeRequest(question)
        const loaded = intent || openRange ? await loadGoadCatalog(gate.session) : null
        const built = openRange && loaded
          ? await askHowToBuildRange({
              intent: { rangeId: "", labHint: "" },
              configured: loaded.configured,
              catalogError: loaded.catalogError,
              catalog: loaded.catalog,
              ranges: await listRangeChoices(host, actor.apiKey),
              blueprints: await listBlueprintChoices(actor.apiKey),
              templates: await listTemplateChoices(actor.apiKey),
              rangeExists: false,
              alreadyLinked: false,
              signal: request.signal,
              control: () => readRun(actor.username, runId),
              takeAnswer: () => takeRunAnswer(actor.username, runId),
              clearSteer: () => { takeRunSteer(actor.username, runId) },
              onChoice: (choice) => setRunChoice(actor.username, runId, choice),
              propose: (spec) => insertChange({
                sessionId,
                username: actor.username,
                rangeId: spec.rangeId,
                kind: spec.args ? "goad_deploy" : "range_create",
                summary: spec.summary,
                preview: spec.preview,
                beforeText: "",
                afterText: spec.args
                  ? storedGoadDeploy(spec)
                  : JSON.stringify({
                      name: spec.create?.name || spec.rangeId,
                      rangeId: spec.rangeId,
                      ...(spec.yaml ? { yaml: spec.yaml } : {}),
                      ...(spec.deploy ? { deploy: true } : {}),
                      rules: spec.rules ?? [],
                    }),
                revertable: false,
              }),
              onEvent: send,
            })
          : null
        const result = built?.followUp
          ? await runLuxaiAgent({
              settings: { ...settings, baseUrl: modelUrl },
              username: actor.username,
              history,
              question: built.followUp,
              signal: request.signal,
              control: () => readRun(actor.username, runId),
              clearSteer: () => { takeRunSteer(actor.username, runId) },
              context: {
                username: actor.username,
                apiKey: actor.apiKey,
                sessionId,
                userText: question,
                host,
                ask: async (choice) => {
                  setRunChoice(actor.username, runId, choice)
                  send({ type: "choice", choice })
                  for (;;) {
                    if (request.signal.aborted) return null
                    const control = readRun(actor.username, runId)
                    if (!control || control.status === "stopped") return null
                    const answer = takeRunAnswer(actor.username, runId)
                    if (answer?.choiceId === choice.id) {
                      setRunChoice(actor.username, runId, null)
                      return { selected: answer.selected, values: answer.values ?? {} }
                    }
                    await new Promise((resolve) => setTimeout(resolve, 200))
                  }
                },
              },
              onEvent: send,
            })
          : built
          ? built
          : intent && loaded
          ? await offerGoadDeploy({
              intent,
              configured: loaded.configured,
              catalogError: loaded.catalogError,
              catalog: loaded.catalog,
              ranges: await listRangeChoices(host, actor.apiKey),
              rangeExists: await rangeExists(host, actor.apiKey, intent.rangeId),
              alreadyLinked: intent.rangeId ? Boolean(getInstanceIdForRange(intent.rangeId)) : false,
              signal: request.signal,
              control: () => readRun(actor.username, runId),
              takeAnswer: () => takeRunAnswer(actor.username, runId),
              clearSteer: () => {
                takeRunSteer(actor.username, runId)
              },
              onChoice: (choice) => setRunChoice(actor.username, runId, choice),
              propose: (spec) => insertChange({
                sessionId,
                username: actor.username,
                rangeId: spec.rangeId,
                kind: "goad_deploy",
                summary: spec.summary,
                preview: spec.preview,
                beforeText: "",
                afterText: storedGoadDeploy(spec),
                revertable: false,
              }),
              onEvent: send,
            })
          : await runLuxaiAgent({
              settings: { ...settings, baseUrl: modelUrl },
              username: actor.username,
              history,
              question,
              signal: request.signal,
              control: () => readRun(actor.username, runId),
              clearSteer: () => {
                takeRunSteer(actor.username, runId)
              },
              context: {
                username: actor.username,
                apiKey: actor.apiKey,
                sessionId,
                userText: question,
                host,
                ask: async (choice) => {
                  setRunChoice(actor.username, runId, choice)
                  send({ type: "choice", choice })
                  for (;;) {
                    if (request.signal.aborted) return null
                    const control = readRun(actor.username, runId)
                    if (!control || control.status === "stopped") return null
                    const answer = takeRunAnswer(actor.username, runId)
                    if (answer?.choiceId === choice.id) {
                      setRunChoice(actor.username, runId, null)
                      return { selected: answer.selected, values: answer.values ?? {} }
                    }
                    await new Promise((resolve) => setTimeout(resolve, 200))
                  }
                },
              },
              onEvent: send,
            })
        setRunChoice(actor.username, runId, null)
        setRunStatus(actor.username, runId, result.stopped ? "stopped" : "done")
        const reasoning = "reasoning" in result && typeof result.reasoning === "string" ? result.reasoning : ""
        addMessage(sessionId, "assistant", result.text, reasoning)
        send({ type: "done", text: result.text })
      } catch (err) {
        setRunChoice(actor.username, runId, null)
        setRunStatus(actor.username, runId, "done")
        const message = err instanceof Error ? err.message : "LUXAI failed."
        const safe = message.slice(0, 500)
        addMessage(sessionId, "assistant", safe)
        send({ type: "error", error: safe })
      } finally {
        closed = true
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      "X-Luxai-Session": sessionId,
      "X-Luxai-Run": runId,
    },
  })
}

async function loadGoadCatalog(session: { username: string; sshPassword?: string }): Promise<{
  configured: boolean
  catalogError: boolean
  catalog: GoadPlanCatalog
}> {
  if (!isGoadConfigured()) return { configured: false, catalogError: false, catalog: { labs: [], extensions: [] } }
  try {
    const creds = session.sshPassword
      ? { username: session.username, password: session.sshPassword }
      : undefined
    const found = await discoverGoadCatalog(creds)
    return { configured: true, catalogError: false, catalog: { labs: found.labs, extensions: found.extensions } }
  } catch {
    return { configured: true, catalogError: true, catalog: { labs: [], extensions: [] } }
  }
}

async function listBlueprintChoices(apiKey: string): Promise<Array<{ id: string; name: string; description?: string }>> {
  try {
    const result = await ludusGet<unknown>("/blueprints", { apiKey })
    if (result.error || result.status >= 400) return []
    return normalizeBlueprintList(result.data).slice(0, 40).map((item) => ({
      id: item.id,
      name: item.name?.trim() || item.id,
      description: item.description?.trim() || undefined,
    }))
  } catch {
    return []
  }
}

async function listTemplateChoices(apiKey: string): Promise<RangeTemplateChoice[]> {
  try {
    const result = await ludusGet<unknown>("/templates", { apiKey })
    if (result.error || result.status >= 400) return []
    return extractArray<Record<string, unknown>>(result.data).flatMap((row) => {
      const id = typeof row.name === "string" ? row.name.trim() : ""
      const built = row.built === true || row.built === 1 || row.built === "true"
      if (!id || !built) return []
      const os = row.os === "windows" || row.os === "linux" || row.os === "macos" || row.os === "other" ? row.os : ""
      return [{ id, os }]
    }).slice(0, 80)
  } catch {
    return []
  }
}

async function listRangeChoices(
  host: ReturnType<typeof createLiveHost>,
  apiKey: string,
): Promise<Array<{ id: string; name: string }>> {
  try {
    const data = await host.listRanges(apiKey)
    return extractArray<Record<string, unknown>>(data).flatMap((row) => {
      const id = typeof row.rangeID === "string" ? row.rangeID : typeof row.rangeId === "string" ? row.rangeId : ""
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return []
      const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id
      return [{ id, name }]
    }).slice(0, 30)
  } catch {
    return []
  }
}

async function rangeExists(
  host: ReturnType<typeof createLiveHost>,
  apiKey: string,
  rangeId: string,
): Promise<boolean> {
  if (!rangeId) return false
  try {
    await host.readRange(apiKey, rangeId)
    return true
  } catch {
    return false
  }
}

function storedGoadDeploy(spec: {
  lab: string
  extensions: string[]
  args: string
  create?: { name: string; rangeId: string } | null
  rules?: RangeRuleDraft[]
}): string {
  return JSON.stringify({
    lab: spec.lab,
    extensions: spec.extensions,
    args: spec.args,
    create: spec.create ?? null,
    rules: spec.rules ?? [],
  })
}
