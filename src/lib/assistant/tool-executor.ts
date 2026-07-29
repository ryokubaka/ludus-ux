import { ludusRequest } from "@/lib/ludus-client"
import { SESSION_COOKIE } from "@/lib/session-edge"
import { signConfirmToken, signAskToken, verifyConfirmToken } from "@/lib/assistant/assistant-config"
import {
  parseAskPrompt,
  mergeExtensionCatalogOptions,
  type AskPrompt,
  type AskOption,
  type AskQuestion,
} from "@/lib/assistant/ask-user"
import {
  assertAskUserAllowed,
  assertWizardAllowsGoadDeploy,
  collectAnsweredWizardAnswers,
  deriveWizardProgress,
} from "@/lib/assistant/wizard-progress"
import {
  pendingMatchesOp,
  policyAllowsOp,
  type AssistantConfirmPolicy,
} from "@/lib/assistant/confirm-policy"
import { formatConfirmDetail, formatConfirmSummary } from "@/lib/assistant/confirm-detail"
import {
  buildRequestPath,
  findOperation,
  filterOperations,
  loadLudusOpenApiOperations,
  loadLuxOpenApiOperations,
  normalizeLudusCallArgs,
  type AssistantToolName,
  type OpenApiOperation,
} from "@/lib/assistant/openapi-tools"
import {
  docsCorpusStats,
  fetchAndCacheLudusDoc,
  readDocByPath,
  searchDocumentation,
  seedLudusDocsCache,
} from "@/lib/assistant/docs-corpus"
import {
  parseLudusTemplateBuiltMap,
  summarizeGoadCatalogForAssistant,
} from "@/lib/assistant/goad-catalog-assist"
import {
  checkExecuteGoadArgs,
  unknownLudusOpHint,
} from "@/lib/assistant/goad-execute-guard"
import {
  extractBuildTemplateNames,
  guardBuildTemplatesAgainstBuiltMap,
  summarizeTemplatesForAssistant,
} from "@/lib/assistant/template-build-guard"
import { checkCreateRangeBody } from "@/lib/assistant/create-range-guard"
import { assertRouterTemplateReady } from "@/lib/ludus-router-template-assert"
import {
  goadExecuteOutputLooksFailed,
  looksLikeHybridGoadArgs,
  looksLikeWizardAnswerDump,
  resolveExecuteGoadFromWizard,
  stripHybridGoadArgsToRepl,
} from "@/lib/goad-wizard-args"

export interface ToolExecContext {
  apiKey: string
  /** Raw Cookie header from the inbound request (for LUX calls). */
  cookieHeader: string
  /** Absolute origin for LUX fetch, e.g. http://127.0.0.1:3000 */
  luxOrigin: string
  impersonateAs?: string
  impersonateApikey?: string
  /** When set, allows one matching destructive call without re-prompt. */
  confirmToken?: string
  /** Conversation-scoped allowlist / allow-all for destructive tools. */
  confirmPolicy?: AssistantConfirmPolicy
  /** Prior chat rows (incl. answered asks) for wizard step gating / GOAD args repair. */
  conversationRows?: Array<{
    kind: string
    text?: string
    title?: string
    message?: string
    questions?: AskQuestion[]
    answers?: import("@/lib/assistant/ask-user").AskAnswers
    resolved?: string
  }>
}

function withQuery(path: string, query?: Record<string, unknown>): string {
  if (!query || Object.keys(query).length === 0) return path
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `${path}?${s}` : path
}

/** When model asks extensions, always merge full GOAD catalog (models often send a tiny subset). */
async function enrichAskUserExtensionsFromCatalog(
  prompt: AskPrompt,
  ctx: ToolExecContext,
): Promise<AskPrompt> {
  const extQs = prompt.questions.filter(
    (q) =>
      (q.type === "multi" || q.type === "single") && /extension/i.test(`${q.id} ${q.prompt}`),
  )
  if (extQs.length === 0) return prompt

  let names: string[] = []
  try {
    const url = `${ctx.luxOrigin.replace(/\/$/, "")}/api/goad/catalog`
    const headers: Record<string, string> = {
      Accept: "application/json",
      Cookie: ctx.cookieHeader,
    }
    if (ctx.impersonateAs) headers["X-Impersonate-As"] = ctx.impersonateAs
    if (ctx.impersonateApikey) headers["X-Impersonate-Apikey"] = ctx.impersonateApikey
    const res = await fetch(url, { method: "GET", headers })
    const data = (await res.json().catch(() => null)) as {
      extensions?: Array<{ name?: string }>
    } | null
    names = (data?.extensions || [])
      .map((e) => (typeof e?.name === "string" ? e.name.trim() : ""))
      .filter(Boolean)
  } catch {
    /* best-effort */
  }
  if (names.length === 0) return prompt

  return {
    ...prompt,
    questions: prompt.questions.map((q) => {
      if (
        (q.type !== "multi" && q.type !== "single") ||
        !/extension/i.test(`${q.id} ${q.prompt}`)
      ) {
        return q
      }
      // Always replace with catalog (drops invented ids like other-extension-1; dedupes).
      const options: AskOption[] = mergeExtensionCatalogOptions(q.options, names)
      return { ...q, id: "extensions", options }
    }),
  }
}

function looksLikeTemplateAddOp(operationId: string): boolean {
  return /template|fromsource|from_source|addtemplate|importtemplate/i.test(operationId)
}

function compactOps(
  ops: OpenApiOperation[],
  limit: number,
  opts?: { surface: "ludus" | "lux"; query?: string },
) {
  const capped = Math.max(1, Math.min(limit || 24, 40))
  const slice = ops.slice(0, capped)
  const groups: Record<string, string[]> = {}
  for (const o of slice) {
    const tag = (o.tags && o.tags[0]) || o.path.split("/").filter(Boolean)[0] || "other"
    if (!groups[tag]) groups[tag] = []
    // Lead with camelCase operationId — models must pass THIS to call_*, not METHOD path.
    groups[tag].push(
      `${o.operationId} — ${o.method.toUpperCase()} ${o.path}${o.summary ? ` — ${o.summary}` : ""}`,
    )
  }
  const q = (opts?.query || "").toLowerCase()
  let assistant_hint =
    "Pass operationId as the camelCase id only (first token before —). Example: call_ludus_api operationId=listTemplates. Never pass 'GET /templates'. If the user asked for an action, continue with describe/call; if they only asked what you can do, summarize and stop."
  if (opts?.surface === "ludus" && /template|packer|build/.test(q)) {
    assistant_hint =
      "Packer BUILD is Ludus: call_ludus_api listTemplates (exact name + built flag), then call_ludus_api buildTemplates body { templates: [\"<exact name>\"] } (POST /templates). Register/add-from-source is LUX addTemplates — not these ops. Do not invent Ludus add-from-source ids."
  } else if (opts?.surface === "lux" && /template|packer|build/.test(q)) {
    assistant_hint =
      "LUX template ops REGISTER only (listTemplateSources → addTemplates). They do NOT run Packer. After register or if already registered, call_ludus_api listTemplates then buildTemplates. Never use LUX to 'build' a template."
  } else if (/goad|goad-mini|mini/.test(q)) {
    assistant_hint =
      opts?.surface === "lux"
        ? "GOAD via LUX: read workflows/goad-deploy.md. ask_user path lux_goad|ludus_blueprint first. getGoadCatalog → match lab (never labs[0]). templateAudit PHASE 1. In-chat ask_user wizard then createRange+executeGoad via call_lux_api. body.args = one string. Never invent --dedicated."
        : "GOAD orchestration is LUX (/api/goad/*). Prefer list_lux_operations query=goad → call_lux_api. Read workflows/goad-deploy.md."
  }
  return {
    total_matched: ops.length,
    returned: slice.length,
    operationIds: slice.map((o) => o.operationId),
    groups,
    assistant_hint,
  }
}

export async function executeAssistantTool(
  name: AssistantToolName,
  argsRaw: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<unknown> {
  let args: Record<string, unknown> = { ...(argsRaw || {}) }

  if (name === "ask_user") {
    const parsed = parseAskPrompt(args)
    if (!parsed.ok) {
      return {
        error: parsed.error,
        assistant_hint:
          "Fix ask_user args: title + questions[{id,prompt,type,options?}]. type=single|multi needs options[]; type=text is free text.",
      }
    }
    let prompt = parsed.prompt
    prompt = await enrichAskUserExtensionsFromCatalog(prompt, ctx)
    if (ctx.conversationRows?.length) {
      const progress = deriveWizardProgress(ctx.conversationRows)
      const gate = assertAskUserAllowed(prompt, progress)
      if (!gate.ok) {
        return {
          error: gate.error,
          assistant_hint: gate.assistant_hint,
        }
      }
    }
    const askToken = signAskToken(prompt)
    return {
      needsInput: true,
      askToken,
      prompt,
      message:
        "Interactive prompt shown in the UI — wait for the user to answer with the buttons/fields. Do not re-ask the same questions in chat text.",
    }
  }

  if (name === "list_ludus_operations") {
    const ops = await loadLudusOpenApiOperations(ctx.apiKey)
    const query = typeof args.query === "string" ? args.query : undefined
    const limit = Number(args.limit) || 40
    const filtered = filterOperations(ops, query, limit)
    return compactOps(filtered, limit, { surface: "ludus", query })
  }

  if (name === "describe_ludus_operation") {
    const ops = await loadLudusOpenApiOperations(ctx.apiKey)
    const op = findOperation(ops, String(args.operationId || ""))
    if (!op) {
      const id = String(args.operationId || "")
      return {
        error: `Unknown Ludus operationId: ${id}`,
        assistant_hint: unknownLudusOpHint(id, looksLikeTemplateAddOp(id)),
      }
    }
    return op
  }

  if (name === "call_ludus_api") {
    const ops = await loadLudusOpenApiOperations(ctx.apiKey)
    const op = findOperation(ops, String(args.operationId || ""))
    if (!op) {
      const id = String(args.operationId || "")
      return {
        error: `Unknown Ludus operationId: ${id}`,
        assistant_hint: unknownLudusOpHint(id, looksLikeTemplateAddOp(id)),
      }
    }
    args = normalizeLudusCallArgs(op, args)
    if (op.destructive) {
      // Refuse Packer rebuild of already-built templates before confirm UI.
      if (op.method === "post" && op.path === "/templates") {
        const requested = extractBuildTemplateNames(args.body)
        try {
          const tplRes = await ludusRequest("/templates", {
            method: "GET",
            apiKey: ctx.apiKey,
            timeout: 60_000,
            userOverride: ctx.impersonateAs,
          })
          if (!tplRes.error) {
            const builtMap = parseLudusTemplateBuiltMap(tplRes.data)
            const guarded = guardBuildTemplatesAgainstBuiltMap(requested, builtMap)
            if (!guarded.ok) {
              return {
                error: guarded.error,
                alreadyBuilt: guarded.alreadyBuilt,
                needBuild: guarded.needBuild,
                missing: guarded.missing,
                assistant_hint: guarded.assistant_hint,
              }
            }
          }
        } catch {
          /* if list fails, fall through to normal confirm */
        }
      }
      // Every Ludus range deploy needs the debian-11 router template built.
      if (op.method === "post" && op.path === "/range/deploy") {
        const router = await assertRouterTemplateReady(ctx.apiKey, {
          userOverride: ctx.impersonateAs,
        })
        if (!router.ok) {
          return { error: router.error, assistant_hint: router.assistant_hint }
        }
      }
      const token = typeof args.confirmToken === "string" ? args.confirmToken : ctx.confirmToken
      const pending = token ? verifyConfirmToken(token) : null
      const allowed =
        policyAllowsOp(ctx.confirmPolicy, "ludus", op.method, op.path) ||
        pendingMatchesOp(pending, "ludus", op.method, op.path)
      if (!allowed) {
        // Strip confirmToken from signed args so the payload stays small/stable.
        const { confirmToken: _ct, ...argsForToken } = args
        const confirmToken = signConfirmToken({
          surface: "ludus",
          operationId: op.operationId,
          method: op.method,
          path: op.path,
          args: argsForToken,
        })
        return {
          needsConfirmation: true,
          confirmToken,
          summary: formatConfirmSummary(op.method, op.path, op.operationId),
          detail: formatConfirmDetail(argsForToken) || undefined,
          message:
            "Destructive Ludus call — wait for the user to choose Allow once / Always allow this / Allow all in the UI. Do not retry the same call.",
        }
      }
    }
    let reqPath = buildRequestPath(op.path, args)
    reqPath = withQuery(reqPath, args.query as Record<string, unknown> | undefined)
    const method = op.method.toUpperCase()
    const body = args.body
    const res = await ludusRequest(reqPath, {
      method,
      apiKey: ctx.apiKey,
      body: body !== undefined ? body : method === "GET" || method === "DELETE" ? undefined : {},
      timeout: 120_000,
      userOverride: ctx.impersonateAs,
    })
    if (op.method === "get" && op.path === "/templates" && !res.error) {
      const summary = summarizeTemplatesForAssistant(res.data)
      return {
        status: res.status,
        error: res.error,
        data: summary,
        assistant_hint:
          "Read data.built and data.not_built. NEVER call buildTemplates for names in built[]. " +
          "GOAD: only Packer-build templateAudit.needBuild / required ∩ not_built. If required templates are all in built[] → templates ready — continue ask_user / deploy, do not rebuild.",
      }
    }
    if (op.method === "post" && op.path === "/templates" && !res.error) {
      return {
        status: res.status,
        error: res.error,
        data: res.data,
        assistant_hint:
          "Packer build STARTED. Tell the user to open /templates (Templates page) for Packer Build Logs. Optional: one GET /templates/logs peek. NEVER call buildTemplates / POST /templates again for this request.",
      }
    }
    return { status: res.status, error: res.error, data: res.data }
  }

  if (name === "list_lux_operations") {
    const ops = loadLuxOpenApiOperations()
    const query = typeof args.query === "string" ? args.query : undefined
    const limit = Number(args.limit) || 40
    const filtered = filterOperations(ops, query, limit)
    return compactOps(filtered, limit, { surface: "lux", query })
  }

  if (name === "describe_lux_operation") {
    const ops = loadLuxOpenApiOperations()
    const op = findOperation(ops, String(args.operationId || ""))
    if (!op) {
      return {
        error: `Unknown LUX operationId: ${args.operationId}`,
        assistant_hint:
          "That operationId does not exist. Call list_lux_operations (query=template for add-from-source). Do not invent operationIds.",
      }
    }
    return op
  }

  if (name === "call_lux_api") {
    const ops = loadLuxOpenApiOperations()
    const op = findOperation(ops, String(args.operationId || ""))
    if (!op) {
      return {
        error: `Unknown LUX operationId: ${args.operationId}`,
        assistant_hint:
          "That operationId does not exist. Call list_lux_operations. Template install uses listTemplateSources + addTemplates.",
      }
    }
    if (op.destructive) {
      // Fail closed before confirm if executeGoad is missing required args.
      if (op.operationId === "executeGoad") {
        if (ctx.conversationRows?.length) {
          const wiz = assertWizardAllowsGoadDeploy(ctx.conversationRows)
          if (!wiz.ok) {
            return { error: wiz.error, assistant_hint: wiz.assistant_hint }
          }
        }

        // Always prefer canonical args from wizard answers (models invent hybrid -l + --repl).
        let body = args.body
        const rawArgs =
          body && typeof body === "object" && typeof (body as { args?: unknown }).args === "string"
            ? String((body as { args: string }).args).trim()
            : ""

        const contextTexts = (ctx.conversationRows || []).flatMap((r) => {
          if (r.kind === "user" || r.kind === "assistant") {
            return typeof (r as { text?: string }).text === "string"
              ? [(r as { text: string }).text]
              : []
          }
          if (r.kind === "ask" && typeof r.title === "string") return [r.title, r.message || ""]
          return []
        })
        const answered = ctx.conversationRows?.length
          ? collectAnsweredWizardAnswers(ctx.conversationRows)
          : {}
        const fixed = ctx.conversationRows?.length
          ? resolveExecuteGoadFromWizard({ answers: answered, contextTexts })
          : null

        if (fixed) {
          body = {
            ...(body && typeof body === "object" ? (body as Record<string, unknown>) : {}),
            args: fixed.args,
            rangeId: fixed.rangeId,
          }
          args = { ...args, body }
        } else if (!rawArgs || looksLikeWizardAnswerDump(rawArgs)) {
          return {
            error:
              "executeGoad body.args is not a GOAD CLI string, and lab/rangeID could not be inferred to auto-build one.",
            assistant_hint:
              'Build args like /goad/new: no extensions → `-l GOAD-Mini -p ludus -m local -t install`; ' +
              'with extensions → ONLY `--repl "unload;set_lab GOAD-Mini;…"` (never prefix with -l/-t install). ' +
              "Also pass body.rangeId. Never dump ask_user answers into args.",
          }
        } else if (looksLikeHybridGoadArgs(rawArgs)) {
          const stripped = stripHybridGoadArgsToRepl(rawArgs)
          if (!stripped) {
            return {
              error: "executeGoad body.args mixes `-l … -t install` with `--repl`.",
              assistant_hint:
                'With extensions use ONLY `--repl "unload;set_lab …;set_extensions …;…"`. Do not prepend `-l … -t install`.',
            }
          }
          body = {
            ...(body && typeof body === "object" ? (body as Record<string, unknown>) : {}),
            args: stripped,
          }
          args = { ...args, body }
        }

        const checked = checkExecuteGoadArgs(body)
        if (!checked.ok) {
          return {
            error: checked.error,
            assistant_hint:
              checked.assistant_hint +
              (fixed
                ? ` Exact args for this wizard: ${JSON.stringify(fixed.args)} with rangeId=${fixed.rangeId}.`
                : ""),
          }
        }
        {
          const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
          const wizardRangeId =
            answered.rangeID?.text?.trim() || answered.existingRangeId?.text?.trim() || ""
          const bodyRange =
            (typeof b.rangeId === "string" && b.rangeId.trim()) ||
            (typeof b.rangeID === "string" && b.rangeID.trim()) ||
            ""
          if (wizardRangeId && !bodyRange) {
            body = { ...b, args: checked.args, rangeId: wizardRangeId }
            args = { ...args, body }
          } else if (!bodyRange && !wizardRangeId && ctx.conversationRows?.length) {
            const progress = deriveWizardProgress(ctx.conversationRows)
            if (progress.flow === "goad_lux") {
              return {
                error: "executeGoad requires body.rangeId (Ludus range ID from wizard).",
                assistant_hint:
                  "Pass body.rangeId = rangeID (new) or existingRangeId (existing). Do not omit it.",
              }
            }
          } else {
            body = { ...b, args: checked.args }
            args = { ...args, body }
          }
        }
        const router = await assertRouterTemplateReady(ctx.apiKey, {
          userOverride: ctx.impersonateAs,
        })
        if (!router.ok) {
          return { error: router.error, assistant_hint: router.assistant_hint }
        }
      }
      if (op.operationId === "createRange" && ctx.conversationRows?.length) {
        const progress = deriveWizardProgress(ctx.conversationRows)
        if (progress.flow === "goad_lux") {
          const wiz = assertWizardAllowsGoadDeploy(ctx.conversationRows)
          if (!wiz.ok) {
            return { error: wiz.error, assistant_hint: wiz.assistant_hint }
          }
          const answered = collectAnsweredWizardAnswers(ctx.conversationRows)
          const rangeSel = (answered.range?.selected || []).map((s) => s.toLowerCase())
          if (rangeSel.some((s) => s === "existing" || s.includes("existing"))) {
            const existingId = answered.existingRangeId?.text?.trim() || ""
            return {
              error: "range=existing — do not call createRange (range already exists).",
              assistant_hint:
                `Skip createRange. Call executeGoad with body.rangeId=${existingId || "<existingRangeId>"} ` +
                "and the canonical GOAD CLI args from the wizard (extensions → --repl only).",
            }
          }
        }
      }
      const token = typeof args.confirmToken === "string" ? args.confirmToken : ctx.confirmToken
      const pending = token ? verifyConfirmToken(token) : null
      const allowed =
        policyAllowsOp(ctx.confirmPolicy, "lux", op.method, op.path) ||
        pendingMatchesOp(pending, "lux", op.method, op.path)
      if (!allowed) {
        const { confirmToken: _ct, ...argsForToken } = args
        const confirmToken = signConfirmToken({
          surface: "lux",
          operationId: op.operationId,
          method: op.method,
          path: op.path,
          args: argsForToken,
        })
        return {
          needsConfirmation: true,
          confirmToken,
          summary: formatConfirmSummary(op.method, op.path, op.operationId),
          detail: formatConfirmDetail(argsForToken) || undefined,
          message:
            "Destructive LUX call — wait for the user to choose Allow once / Always allow this / Allow all in the UI. Do not retry the same call.",
        }
      }
    } else if (op.operationId === "createRange") {
      const checked = checkCreateRangeBody(args.body)
      if (!checked.ok) {
        return {
          error: checked.error,
          assistant_hint: checked.assistant_hint,
        }
      }
    }
    let reqPath = buildRequestPath(op.path, args)
    reqPath = withQuery(reqPath, args.query as Record<string, unknown> | undefined)
    const url = `${ctx.luxOrigin.replace(/\/$/, "")}${reqPath}`
    const headers: Record<string, string> = {
      Accept: "application/json",
      Cookie: ctx.cookieHeader.includes(SESSION_COOKIE)
        ? ctx.cookieHeader
        : ctx.cookieHeader,
    }
    if (ctx.impersonateAs) headers["X-Impersonate-As"] = ctx.impersonateAs
    if (ctx.impersonateApikey) headers["X-Impersonate-Apikey"] = ctx.impersonateApikey
    const method = op.method.toUpperCase()
    if (args.body !== undefined && method !== "GET") {
      headers["Content-Type"] = "application/json"
    }
    try {
      const res = await fetch(url, {
        method,
        headers,
        body:
          args.body !== undefined && method !== "GET" && method !== "HEAD"
            ? JSON.stringify(args.body)
            : undefined,
      })
      const text = await res.text()
      let data: unknown = text
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        /* keep text */
      }
      if (op.operationId === "addTemplates" && res.status >= 200 && res.status < 300) {
        return {
          status: res.status,
          data,
          assistant_hint:
            "addTemplates only REGISTERS Packer files (or reports already registered). Tell the user to open /templates. To make usable: Ludus listTemplates → buildTemplates once. Do not call listTemplateSources/addTemplates again unless adding a different template.",
        }
      }
      if (op.operationId === "getGoadCatalog" && res.status >= 200 && res.status < 300) {
        let templatesData: unknown
        try {
          const tplRes = await ludusRequest("/templates", {
            method: "GET",
            apiKey: ctx.apiKey,
            timeout: 60_000,
            userOverride: ctx.impersonateAs,
          })
          if (!tplRes.error) templatesData = tplRes.data
        } catch {
          /* join is best-effort; summary still useful without audit */
        }
        const summary = summarizeGoadCatalogForAssistant(data, templatesData)
        if (summary) {
          return {
            status: res.status,
            data: summary,
            assistant_hint: summary.assistant_hint,
          }
        }
      }
      if (op.operationId === "executeGoad") {
        const blob = typeof data === "string" ? data : JSON.stringify(data ?? "")
        if (/No command args provided/i.test(blob)) {
          return {
            status: res.status,
            data,
            error: "executeGoad failed: body.args was missing",
            assistant_hint:
              "executeGoad failed: body.args was missing. Ask the user for extensions / new vs existing / range, or send them to /goad. Do not retry with only labName.",
          }
        }
        if (goadExecuteOutputLooksFailed(blob)) {
          return {
            status: res.status,
            data,
            error: "GOAD CLI failed (bad args or install error) — deploy did NOT succeed.",
            assistant_hint:
              "Do not tell the user the deploy succeeded. " +
              "Typical cause: mixed `-l … -t install` with `--repl`. " +
              'Retry executeGoad with ONLY `--repl "unload;set_lab …"` when extensions are set, plus body.rangeId. ' +
              "No extensions → only `-l 'Lab' -p ludus -m local -t install`.",
          }
        }
        return {
          status: res.status,
          data,
          assistant_hint:
            "GOAD task started. Server links the new workspace to body.rangeId (dashboard GOAD Instance button + ownership). " +
            "Tell the user to open Dashboard for that range or /goad when the instance appears (~30–60s). Do not re-call executeGoad.",
        }
      }
      return { status: res.status, data }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  if (name === "search_documentation") {
    const query = String(args.query || "").trim()
    if (!query) return { error: "query required" }
    const hits = searchDocumentation(query, Number(args.limit) || 8)
    const stats = docsCorpusStats()
    return {
      hits,
      corpus: stats,
      assistant_hint:
        hits.length > 0
          ? "Call read_documentation with the exact hit.path string (e.g. skills/ludus-ux/references/environment-guide.md). Do not invent /docs/environment-guides/... paths unless fetch_ludus_doc cached them."
          : "No local hits. Call fetch_ludus_doc with seed:true or a specific /docs/... path, then search again.",
    }
  }

  if (name === "fetch_ludus_doc") {
    if (args.seed === true) {
      const result = await seedLudusDocsCache({ force: false })
      return {
        seeded: true,
        ...result,
        corpus: docsCorpusStats(),
        assistant_hint: "Core Ludus docs seeded into cache. search_documentation again, then answer the user.",
      }
    }
    const urlOrPath = String(args.urlOrPath || "").trim()
    if (!urlOrPath) return { error: "urlOrPath required (or set seed:true)" }
    const result = await fetchAndCacheLudusDoc(urlOrPath)
    if (!result.ok) return result
    return {
      ...result,
      corpus: docsCorpusStats(),
      assistant_hint: "Page cached. search_documentation or read_documentation, then answer the user.",
    }
  }

  if (name === "read_documentation") {
    const docPath = String(args.path || "").trim()
    if (!docPath) return { error: "path required" }
    const page = readDocByPath(docPath)
    if (!page) {
      const suggestions = searchDocumentation(docPath.replace(/[/_.-]+/g, " "), 5)
      return {
        error: `Documentation not found: ${docPath}`,
        assistant_hint:
          "Use an exact path from search_documentation hits. Skill lab recipes live under skills/ludus-ux/references/ (e.g. environment-guide.md). Upstream pages need fetch_ludus_doc first.",
        suggestions: suggestions.map((h) => ({ path: h.path, title: h.title, score: h.score })),
      }
    }
    const maxChars = Math.max(500, Math.min(Number(args.maxChars) || 6000, 12_000))
    const body = page.body.length > maxChars ? `${page.body.slice(0, maxChars)}\n\n…(truncated)` : page.body
    return {
      source: page.source,
      title: page.title,
      path: page.path,
      url: page.url,
      body,
    }
  }

  return { error: `Unknown tool: ${name}` }
}
