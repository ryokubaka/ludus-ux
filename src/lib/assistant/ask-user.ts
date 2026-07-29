/**
 * Structured user prompts for the assistant (button choices + optional text).
 * Mirrors destructive confirm UX for non-open-ended clarifying questions.
 */

export type AskOption = {
  id: string
  label: string
}

export type AskQuestion = {
  id: string
  prompt: string
  /** single = one option; multi = many; text = free-text only */
  type: "single" | "multi" | "text"
  options?: AskOption[]
  /** Show a free-text field alongside choices (single/multi). */
  allowCustom?: boolean
  required?: boolean
}

export type AskPrompt = {
  title: string
  message?: string
  questions: AskQuestion[]
}

/** User's submitted answers keyed by question id. */
export type AskAnswers = Record<
  string,
  {
    /** Selected option id(s). */
    selected?: string[]
    /** Free-text / custom value. */
    text?: string
  }
>

const MAX_QUESTIONS = 8
/** GOAD catalogs can list many extensions; keep headroom + reserved "none". */
const MAX_OPTIONS = 40
const MAX_LABEL = 120
const MAX_PROMPT = 400

function cleanId(raw: unknown, fallback: string): string {
  const s = String(raw ?? "")
    .trim()
    .slice(0, 64)
    .replace(/[^\w.-]+/g, "_")
  return s || fallback
}

function cleanLabel(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_LABEL)
}

function looksLikeExtensionsQuestion(id: string, prompt: string): boolean {
  // Never rewrite confirm/deploy/range/etc. just because the prompt mentions "Extensions:" in a summary.
  if (
    /^(confirm|deploy|cancel|path|range|rangeid|network|lab|method|blueprint|yaml|goadtype|integration)$/i.test(
      id.trim(),
    )
  ) {
    return false
  }
  if (/extension/i.test(id)) return true
  if (/confirm|proceed with|do you want to proceed|deployment of/i.test(prompt)) return false
  // Generic ids only — avoid stealing confirm cards that list extension choices in the summary text.
  if (/^q\d+$/i.test(id) && /extension/i.test(prompt)) return true
  return false
}

/** True when extension options look incomplete vs a full GOAD catalog. */
export function extensionsOptionsNeedCatalog(
  options: AskOption[] | undefined,
  catalogSize?: number,
): boolean {
  if (!options?.length) return true
  const nonNone = options.filter((o) => !/^none$/i.test(o.id) && !/^none$/i.test(o.label))
  if (nonNone.length === 0) return true
  // Model often sends a tiny subset (e.g. only smoke-ci) — treat as incomplete.
  if (typeof catalogSize === "number" && catalogSize > 0) {
    return nonNone.length < catalogSize
  }
  // Heuristic without catalog: real catalogs have many extensions; < 5 is suspicious.
  return nonNone.length < 5
}

/** Merge catalog extensionNames into options (None first). Drops invented ids not in catalog. */
export function mergeExtensionCatalogOptions(
  options: AskOption[] | undefined,
  extensionNames: string[],
): AskOption[] {
  const fromCatalog: AskOption[] = []
  const seen = new Set<string>()
  for (const raw of extensionNames) {
    const label = cleanLabel(raw)
    if (!label) continue
    const id = cleanId(raw, label)
    if (/^none$/i.test(id) || seen.has(id)) continue
    seen.add(id)
    const prior = (options || []).find((o) => o.id.toLowerCase() === id.toLowerCase())
    fromCatalog.push({ id, label: prior?.label?.trim() || label })
  }
  return ensureNoneExtensionOption(fromCatalog)
}

const RANGE_ID_PROMPT =
  "Ludus range ID (this is the range name — e.g. alice-GOAD-Mini-LDQ8)"

const EXISTING_RANGE_ID_PROMPT = "Existing Ludus range ID to deploy GOAD into"

/**
 * Fix confusing model wording / wrong question ids for GOAD wizard cards.
 * - "path for the new range" text → rangeID
 * - existing range text → existingRangeId (must not become rangeID)
 * - goadType / lux_goad|ludus_blueprint options → path
 * - new|existing options mislabeled as path → range
 * - Do not rewrite confirm cards that mention "Extensions:" in the summary
 */
export function normalizeWizardAskPrompt(prompt: AskPrompt): AskPrompt {
  const questions = prompt.questions.map((q) => {
    const optIds = (q.options || []).map((o) => o.id.toLowerCase())
    const hasLuxPath =
      optIds.includes("lux_goad") ||
      optIds.includes("ludus_blueprint") ||
      optIds.some((id) => id.includes("lux_goad") || id.includes("ludus_blueprint"))
    const hasNewExisting =
      (optIds.includes("new") || optIds.some((id) => /^new_?range$/i.test(id))) &&
      (optIds.includes("existing") || optIds.some((id) => /existing/i.test(id)))

    // GOAD integration path (must stay id=path)
    if (q.type === "single" && hasLuxPath) {
      return {
        ...q,
        id: "path",
        prompt: "Deploy via which integration?",
      }
    }

    // Range new vs existing — models often misuse id=path here
    if (q.type === "single" && hasNewExisting && !hasLuxPath) {
      return {
        ...q,
        id: "range",
        prompt: "Create a new dedicated Ludus range, or use an existing one?",
      }
    }

    const blob = `${q.id} ${q.prompt}`
    const idCanon = q.id.trim().toLowerCase().replace(/-/g, "_")

    // Existing range id — check BEFORE rangeID rewrite (id "existingRangeId" matches /rangeid/i)
    const looksLikeExistingRangeAsk =
      q.type === "text" &&
      (idCanon === "existingrangeid" ||
        idCanon === "existing_range_id" ||
        idCanon === "existing_range" ||
        idCanon === "existingrange" ||
        (/existing/i.test(blob) && /range/i.test(blob)))

    if (looksLikeExistingRangeAsk) {
      return {
        ...q,
        id: "existingRangeId",
        prompt: EXISTING_RANGE_ID_PROMPT,
      }
    }

    const looksLikeRangeNameAsk =
      q.type === "text" &&
      (/rangeid|range_id|rangename|range_name/i.test(q.id) ||
        /(?:path|name|id).{0,24}(?:new\s+)?range|(?:new\s+)?range.{0,24}(?:path|name|id)/i.test(blob))

    if (looksLikeRangeNameAsk) {
      return {
        ...q,
        id: "rangeID",
        prompt: RANGE_ID_PROMPT,
      }
    }
    if (canonicalizeMaybeRangeId(q.id) === "rangeID" && q.type === "text") {
      return { ...q, id: "rangeID", prompt: RANGE_ID_PROMPT }
    }
    if (looksLikeExtensionsQuestion(q.id, q.prompt) && (q.type === "multi" || q.type === "single")) {
      return {
        ...q,
        id: "extensions",
        prompt: "Optional GOAD extensions (not lab types). Pick any, or None.",
      }
    }
    if (/^(confirm|deploy|review)$/i.test(q.id) || (/confirm|proceed/i.test(q.prompt) && q.type === "single")) {
      return {
        ...q,
        id: "confirm",
        prompt: q.prompt.slice(0, MAX_PROMPT),
      }
    }
    return q
  })

  let title = prompt.title
  if (questions.some((q) => q.id === "existingRangeId")) {
    title = "Existing Ludus range"
  } else if (
    questions.some((q) => q.id === "rangeID") &&
    /path/i.test(title) &&
    !/lux|blueprint|deploy path/i.test(title)
  ) {
    title = "New Ludus range name"
  }
  if (questions.some((q) => q.id === "extensions") && /path/i.test(title)) {
    title = "GOAD extensions"
  }
  if (questions.some((q) => q.id === "confirm")) {
    title = title.match(/confirm/i) ? title : "Confirm GOAD deploy"
  }

  return { ...prompt, title, questions }
}

function canonicalizeMaybeRangeId(id: string): string {
  const lower = id.trim().toLowerCase().replace(/-/g, "_")
  if (
    lower === "rangeid" ||
    lower === "range_id" ||
    lower === "rangename" ||
    lower === "range_name" ||
    lower === "newrangeid" ||
    lower === "new_range_id"
  ) {
    return "rangeID"
  }
  return id
}

/** Always lead with None for extension multi/single picks; never drop it when capping. */
export function ensureNoneExtensionOption(options: AskOption[]): AskOption[] {
  const isNone = (o: AskOption) => /^none$/i.test(o.id) || /^none$/i.test(o.label)
  const noneOpt: AskOption = { id: "none", label: "None" }
  const rest = options.filter((o) => !isNone(o))
  const existingNone = options.find(isNone)
  const none = existingNone ? { id: "none", label: existingNone.label || "None" } : noneOpt
  const capped = rest.slice(0, Math.max(0, MAX_OPTIONS - 1))
  return [none, ...capped]
}

/** Normalize/validate model-provided ask_user args into a prompt, or return an error. */
export function parseAskPrompt(args: Record<string, unknown>): { ok: true; prompt: AskPrompt } | { ok: false; error: string } {
  const title = cleanLabel(args.title) || "Choose an option"
  const message =
    typeof args.message === "string" && args.message.trim()
      ? args.message.trim().slice(0, 800)
      : undefined

  const rawQs = args.questions
  if (!Array.isArray(rawQs) || rawQs.length === 0) {
    return { ok: false, error: "ask_user requires a non-empty questions array" }
  }
  if (rawQs.length > MAX_QUESTIONS) {
    return { ok: false, error: `ask_user allows at most ${MAX_QUESTIONS} questions` }
  }

  const questions: AskQuestion[] = []
  for (let i = 0; i < rawQs.length; i++) {
    const q = rawQs[i] as Record<string, unknown>
    if (!q || typeof q !== "object") {
      return { ok: false, error: `questions[${i}] must be an object` }
    }
    const id = cleanId(q.id, `q${i + 1}`)
    const prompt = String(q.prompt ?? "")
      .trim()
      .slice(0, MAX_PROMPT)
    if (!prompt) return { ok: false, error: `questions[${i}].prompt is required` }

    let type = String(q.type || "single").toLowerCase()
    if (type !== "single" && type !== "multi" && type !== "text") type = "single"

    const required = q.required !== false
    const allowCustom = !!q.allowCustom

    let options: AskOption[] | undefined
    if (type === "single" || type === "multi") {
      const rawOpts = q.options
      if (!Array.isArray(rawOpts) || rawOpts.length === 0) {
        return { ok: false, error: `questions[${i}] (${type}) requires options[]` }
      }
      options = rawOpts.slice(0, MAX_OPTIONS).map((o, j) => {
        if (o && typeof o === "object") {
          const rec = o as Record<string, unknown>
          return {
            id: cleanId(rec.id ?? rec.value, `opt${j + 1}`),
            label: cleanLabel(rec.label ?? rec.id ?? rec.value) || `Option ${j + 1}`,
          }
        }
        const label = cleanLabel(o) || `Option ${j + 1}`
        return { id: cleanId(label, `opt${j + 1}`), label }
      })
      if (looksLikeExtensionsQuestion(id, prompt)) {
        options = ensureNoneExtensionOption(options)
      }
    }

    questions.push({
      id,
      prompt,
      type: type as AskQuestion["type"],
      options,
      allowCustom: type === "text" ? true : allowCustom,
      required,
    })
  }

  return { ok: true, prompt: normalizeWizardAskPrompt({ title, message, questions }) }
}

/** Validate submitted answers against the prompt. */
export function validateAskAnswers(
  prompt: AskPrompt,
  answers: AskAnswers | null | undefined,
): { ok: true; answers: AskAnswers } | { ok: false; error: string } {
  if (!answers || typeof answers !== "object") {
    return { ok: false, error: "answers required" }
  }
  const out: AskAnswers = {}
  for (const q of prompt.questions) {
    const a = answers[q.id]
    const selected = Array.isArray(a?.selected)
      ? a!.selected.map((s) => String(s)).filter(Boolean)
      : []
    const text = typeof a?.text === "string" ? a.text.trim().slice(0, 2000) : ""

    if (q.type === "text") {
      if (q.required && !text) {
        return { ok: false, error: `Answer required for: ${q.prompt}` }
      }
      out[q.id] = { text: text || undefined }
      continue
    }

    const validIds = new Set((q.options || []).map((o) => o.id))
    const picked = selected.filter((id) => validIds.has(id))
    if (q.type === "single" && picked.length > 1) {
      return { ok: false, error: `Pick only one option for: ${q.prompt}` }
    }
    if (q.required && picked.length === 0 && !(q.allowCustom && text)) {
      return { ok: false, error: `Answer required for: ${q.prompt}` }
    }
    out[q.id] = {
      selected: picked.length ? (q.type === "single" ? [picked[0]] : picked) : undefined,
      text: text || undefined,
    }
  }
  return { ok: true, answers: out }
}

/** Compact summary for chat status / LLM continuation. */
export function formatAskAnswersForModel(prompt: AskPrompt, answers: AskAnswers): string {
  const lines: string[] = [`User answered interactive prompt "${prompt.title}":`]
  for (const q of prompt.questions) {
    const a = answers[q.id]
    const parts: string[] = []
    if (a?.selected?.length) {
      const labels = a.selected.map((id) => {
        const opt = q.options?.find((o) => o.id === id)
        return opt ? `${opt.label} (${id})` : id
      })
      parts.push(labels.join(", "))
    }
    if (a?.text) parts.push(`custom: ${a.text}`)
    lines.push(`- ${q.id} (${q.prompt}): ${parts.join(" · ") || "(empty)"}`)
  }
  return lines.join("\n")
}

/** Minimal ask-row shape for cumulative formatting (avoids store import cycle). */
export type AnsweredAskRow = {
  kind: string
  title?: string
  message?: string
  questions?: AskQuestion[]
  answers?: AskAnswers
  resolved?: string
}

/**
 * Concatenate every answered ask_user card in conversation order.
 * Needed because LLM history drops `ask` rows — without this the model re-asks prior steps.
 */
export function formatAllAskAnswersForModel(rows: AnsweredAskRow[]): string {
  const blocks: string[] = []
  for (const r of rows) {
    if (r.kind !== "ask" || r.resolved !== "answered") continue
    if (!r.questions?.length || !r.answers) continue
    const prompt: AskPrompt = {
      title: r.title || "Prompt",
      message: r.message,
      questions: r.questions,
    }
    blocks.push(formatAskAnswersForModel(prompt, r.answers))
  }
  return blocks.join("\n\n")
}
