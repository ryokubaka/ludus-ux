/**
 * Server-side GOAD / range deploy wizard progress from answered ask_user cards.
 * Prevents re-ask loops when LLM history drops ask rows.
 */

import {
  formatAllAskAnswersForModel,
  type AskAnswers,
  type AskPrompt,
  type AskQuestion,
  type AnsweredAskRow,
} from "@/lib/assistant/ask-user"

export type WizardFlow = "none" | "goad_lux" | "goad_blueprint" | "range_deploy"

export type WizardStepId =
  | "path"
  | "lab"
  | "extensions"
  | "range"
  | "rangeID"
  | "existingRangeId"
  | "network"
  | "network_yaml"
  | "confirm"
  | "method"
  | "blueprint"
  | "yaml"
  | "wizard_intent"

export type WizardProgress = {
  flow: WizardFlow
  /** Canonical step ids already answered. */
  answeredIds: string[]
  /** Next required ask_user question id, or null when wizard done / inactive. */
  nextStep: WizardStepId | null
  /** Instruction for the model (continuation / prose nudge). */
  nextAskHint: string
}

type AnswerValue = { selected?: string[]; text?: string }

/** Map model-varying question ids onto canonical step ids. */
export function canonicalizeQuestionId(
  id: string,
  selected?: string[],
): WizardStepId | string {
  const raw = id.trim()
  const lower = raw.toLowerCase().replace(/-/g, "_")
  const sels = (selected || []).map((s) => s.toLowerCase())

  if (
    lower === "goadtype" ||
    lower === "goad_type" ||
    lower === "integration" ||
    lower === "deploy_method" ||
    lower === "deploymethod"
  ) {
    return "path"
  }

  if (lower === "path" || lower === "deploy_path" || lower === "deploypath") {
    // Models often reuse id=path for new|existing range mode — map to range.
    if (
      sels.some(
        (s) =>
          s === "new" ||
          s === "existing" ||
          s.includes("new range") ||
          s.includes("existing range"),
      )
    ) {
      return "range"
    }
    return "path"
  }
  if (lower === "lab" || lower === "labname" || lower === "lab_name") return "lab"
  if (lower === "extensions" || lower === "extension" || lower === "ext") return "extensions"
  if (
    lower === "range" ||
    lower === "rangetype" ||
    lower === "range_type" ||
    lower === "range_mode" ||
    lower === "rangemode" ||
    lower === "selectrangetype"
  ) {
    return "range"
  }
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
  if (
    lower === "existingrangeid" ||
    lower === "existing_range" ||
    lower === "existing_range_id" ||
    lower === "existingrange"
  ) {
    return "existingRangeId"
  }
  if (lower === "network" || lower === "networkrules" || lower === "network_rules") return "network"
  if (
    lower === "network_yaml" ||
    lower === "networkyaml" ||
    lower === "network_yml" ||
    lower === "networkyml"
  ) {
    return "network_yaml"
  }
  if (lower === "confirm" || lower === "deploy" || lower === "review") return "confirm"
  if (lower === "method" || lower === "config_method" || lower === "configmethod") return "method"
  if (lower === "blueprint" || lower === "blueprint_id" || lower === "blueprintid") return "blueprint"
  if (lower === "yaml" || lower === "config_yaml" || lower === "rangeyaml") return "yaml"
  if (lower === "wizard_intent" || lower === "wizardintent" || lower === "intent") return "wizard_intent"
  return raw
}

function selectedOf(answers: Record<string, AnswerValue>, canonical: WizardStepId): string[] {
  for (const [k, v] of Object.entries(answers)) {
    if (canonicalizeQuestionId(k, v?.selected) === canonical && v?.selected?.length) return v.selected
  }
  return []
}

function hasAnswer(answers: Record<string, AnswerValue>, canonical: WizardStepId): boolean {
  for (const [k, v] of Object.entries(answers)) {
    if (canonicalizeQuestionId(k, v?.selected) !== canonical) continue
    if (v?.selected?.length) return true
    if (v?.text?.trim()) return true
  }
  return false
}

/** Flatten answered ask rows into canonical-id → answer. Later cards win on same id. */
export function collectAnsweredWizardAnswers(rows: AnsweredAskRow[]): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {}
  for (const r of rows) {
    if (r.kind !== "ask" || r.resolved !== "answered" || !r.answers) continue
    for (const [qid, ans] of Object.entries(r.answers)) {
      const canon = canonicalizeQuestionId(qid, ans.selected)
      out[canon] = {
        selected: ans.selected?.length ? [...ans.selected] : undefined,
        text: ans.text?.trim() || undefined,
      }
    }
  }
  return out
}

function detectFlow(answers: Record<string, AnswerValue>): WizardFlow {
  const pathSel = selectedOf(answers, "path").map((s) => s.toLowerCase())
  if (pathSel.some((s) => s === "lux_goad" || s.includes("lux"))) return "goad_lux"
  if (pathSel.some((s) => s === "ludus_blueprint" || s.includes("blueprint"))) return "goad_blueprint"
  if (hasAnswer(answers, "extensions")) return "goad_lux"
  // Range deploy: path = new|existing (rare after remap) or range=new|existing without GOAD path
  if (pathSel.some((s) => s === "new" || s === "existing") && hasAnswer(answers, "method")) {
    return "range_deploy"
  }
  if (pathSel.some((s) => s === "new" || s === "existing") && !hasAnswer(answers, "extensions")) {
    return "range_deploy"
  }
  if (hasAnswer(answers, "range") && hasAnswer(answers, "extensions")) return "goad_lux"
  if (hasAnswer(answers, "range") && pathSel.some((s) => s.includes("lux") || s.includes("blueprint"))) {
    return "goad_lux"
  }
  // Isolated new|existing (often remapped from id=path) → range deploy, not GOAD
  if (hasAnswer(answers, "range") && !hasAnswer(answers, "extensions") && !hasAnswer(answers, "method")) {
    return "range_deploy"
  }
  if (hasAnswer(answers, "method")) return "range_deploy"
  return "none"
}

function goadLuxNext(answers: Record<string, AnswerValue>): WizardStepId | null {
  if (!hasAnswer(answers, "path")) return "path"
  // lab is optional when already implied (user named lab / catalog match)
  if (!hasAnswer(answers, "extensions")) return "extensions"
  if (!hasAnswer(answers, "range")) return "range"
  const rangeSel = selectedOf(answers, "range").map((s) => s.toLowerCase())
  if (rangeSel.some((s) => s === "new" || s.includes("new"))) {
    if (!hasAnswer(answers, "rangeID")) return "rangeID"
  } else if (rangeSel.some((s) => s === "existing" || s.includes("existing"))) {
    if (!hasAnswer(answers, "existingRangeId")) return "existingRangeId"
  }
  if (!hasAnswer(answers, "network")) return "network"
  const netSel = selectedOf(answers, "network").map((s) => s.toLowerCase())
  if (netSel.some((s) => s === "custom" || s.includes("custom"))) {
    if (!hasAnswer(answers, "network_yaml")) return "network_yaml"
  }
  if (!hasAnswer(answers, "confirm")) return "confirm"
  return null
}

function rangeDeployNext(answers: Record<string, AnswerValue>): WizardStepId | null {
  const pathSel = selectedOf(answers, "path").map((s) => s.toLowerCase())
  const rangeSel = selectedOf(answers, "range").map((s) => s.toLowerCase())
  // Range-deploy "path" new|existing may be stored under canonical "range"
  const modeSel = pathSel.length ? pathSel : rangeSel
  if (!modeSel.length) return "path"

  if (modeSel.some((s) => s === "existing" || s.includes("existing"))) {
    if (!hasAnswer(answers, "existingRangeId") && !hasAnswer(answers, "rangeID")) {
      return "existingRangeId"
    }
  }
  if (!hasAnswer(answers, "method")) return "method"
  const method = selectedOf(answers, "method").map((s) => s.toLowerCase())
  if (method.some((s) => s === "blueprint" || s.includes("blueprint"))) {
    if (!hasAnswer(answers, "blueprint")) return "blueprint"
  } else if (method.some((s) => s === "yaml" || s.includes("yaml"))) {
    if (!hasAnswer(answers, "yaml")) return "yaml"
  } else if (method.some((s) => s === "wizard" || s.includes("wizard"))) {
    if (!hasAnswer(answers, "wizard_intent")) return "wizard_intent"
  }
  if (modeSel.some((s) => s === "new" || s.includes("new")) && !hasAnswer(answers, "rangeID")) {
    return "rangeID"
  }
  if (!hasAnswer(answers, "confirm")) return "confirm"
  return null
}

/** GOAD lux steps that may share one ask_user card after path. */
const GOAD_PHASE1_BUNDLE = new Set<WizardStepId>(["extensions", "range", "network"])

const STEP_HINTS: Record<WizardStepId, string> = {
  path: "NEXT ask_user MUST be id=path (GOAD: lux_goad|ludus_blueprint; range-deploy: new|existing). One card only.",
  lab: "NEXT ask_user MUST be id=lab (single), options from catalog labNames only — not extensions.",
  extensions:
    "PREFERRED: one ask_user card bundling id=extensions (multi, full catalog extensionNames + leading None) + id=range (new|existing) + id=network (skip|custom). Do NOT re-ask path. Follow-ups stay separate: rangeID if new, network_yaml if custom, then confirm.",
  range:
    "Ask id=range (new|existing) alone, OR bundle remaining unanswered of range+network. Prefer bundling if network unanswered. Do NOT re-ask extensions. Do NOT invent rangeID yet.",
  rangeID:
    "NEXT ask_user MUST be type=text id=rangeID. Prompt must ask for the Ludus range ID/name (NOT 'path'). Example label: \"Ludus range ID (range name)\". Do NOT re-ask extensions or range mode. Do NOT use id=path here — path was lux_goad|ludus_blueprint.",
  existingRangeId:
    "NEXT ask_user MUST be type=text id=existingRangeId (existing Ludus range id). Do NOT re-ask extensions.",
  network:
    "NEXT ask_user MUST be id=network (single): skip | custom. Do NOT re-ask range/extensions.",
  network_yaml:
    "NEXT ask_user MUST be type=text id=network_yaml (network YAML or description). Do NOT re-ask network mode.",
  confirm:
    "NEXT ask_user MUST be id=confirm (deploy|cancel). Summarize answered steps; then createRange/executeGoad only after confirm.",
  method:
    "NEXT ask_user MUST be id=method (wizard|yaml|blueprint). Do NOT re-ask path.",
  blueprint: "NEXT ask_user MUST be id=blueprint (pick installed blueprint id).",
  yaml: "NEXT ask_user MUST be id=yaml (paste/confirm range config YAML).",
  wizard_intent:
    "NEXT ask_user MUST be id=wizard_intent (high-level VM/domain intent) or point user to /range/new if too complex.",
}

function hintFor(flow: WizardFlow, next: WizardStepId | null): string {
  if (flow === "none") {
    return (
      "No deploy wizard answers yet. For GOAD: ask_user path lux_goad|ludus_blueprint first " +
      "(workflows/goad-deploy.md). For range-only: workflows/range-deploy.md."
    )
  }
  if (flow === "goad_blueprint") {
    return (
      "Path=ludus_blueprint. Continue via workflows/range-deploy.md / sources-ansible " +
      "(install goad blueprint, then range deploy). Do NOT call executeGoad. Do not re-ask GOAD path."
    )
  }
  if (!next) {
    if (flow === "goad_lux") {
      return (
        "GOAD wizard answers complete. Only after confirm=deploy: " +
        "createRange {rangeID,name} then executeGoad with string args + rangeId. Do not re-ask wizard steps."
      )
    }
    return (
      "Range deploy wizard answers complete. Proceed with createRange/setRangeConfig/deployRange per playbook. " +
      "Do not re-ask wizard steps."
    )
  }
  const base = STEP_HINTS[next]
  if (flow === "goad_lux") {
    return `GOAD lux_goad wizard (workflows/goad-deploy.md). ${base} Never re-ask steps already in Wizard answers.`
  }
  return `Range deploy wizard (workflows/range-deploy.md). ${base} Never re-ask steps already in Wizard answers.`
}

export function deriveWizardProgress(rows: AnsweredAskRow[]): WizardProgress {
  const answers = collectAnsweredWizardAnswers(rows)
  const answeredIds = Object.keys(answers).filter((k) => {
    const v = answers[k]
    return !!(v?.selected?.length || v?.text?.trim())
  })
  const flow = detectFlow(answers)
  let nextStep: WizardStepId | null = null
  if (flow === "goad_lux") nextStep = goadLuxNext(answers)
  else if (flow === "goad_blueprint") nextStep = null
  else if (flow === "range_deploy") nextStep = rangeDeployNext(answers)

  return {
    flow,
    answeredIds,
    nextStep,
    nextAskHint: hintFor(flow, nextStep),
  }
}

/** Block createRange/executeGoad until lux_goad wizard confirm=deploy. */
export function assertWizardAllowsGoadDeploy(
  rows: AnsweredAskRow[],
): { ok: true } | { ok: false; error: string; assistant_hint: string } {
  const progress = deriveWizardProgress(rows)
  if (progress.flow !== "goad_lux") return { ok: true }
  if (progress.nextStep) {
    return {
      ok: false,
      error: `GOAD wizard incomplete — next ask_user id="${progress.nextStep}". Do not createRange/executeGoad yet.`,
      assistant_hint: progress.nextAskHint,
    }
  }
  const answers = collectAnsweredWizardAnswers(rows)
  const conf = selectedOf(answers, "confirm").map((s) => s.toLowerCase())
  if (conf.some((s) => s === "cancel" || s.includes("cancel"))) {
    return {
      ok: false,
      error: "User cancelled GOAD deploy on the confirm card.",
      assistant_hint: "Do not createRange or executeGoad after cancel. Ask what they want instead.",
    }
  }
  if (!hasAnswer(answers, "confirm")) {
    return {
      ok: false,
      error: 'GOAD wizard missing confirm (ask_user id="confirm" deploy|cancel).',
      assistant_hint: progress.nextAskHint,
    }
  }
  return { ok: true }
}

export type AskUserGate =
  | { ok: true }
  | { ok: false; error: string; assistant_hint: string }

function promptQuestionIds(prompt: AskPrompt): string[] {
  return prompt.questions.map((q) => canonicalizeQuestionId(q.id))
}

/**
 * Reject out-of-order ask_user cards when a GOAD/range wizard is in progress.
 * Allows the exact next step (or inactive wizard).
 */
export function assertAskUserAllowed(prompt: AskPrompt, progress: WizardProgress): AskUserGate {
  if (progress.flow === "none" || progress.flow === "goad_blueprint") {
    return { ok: true }
  }
  if (!progress.nextStep) {
    // Wizard complete — still allow confirm re-show is rare; block re-asking earlier steps
    const ids = promptQuestionIds(prompt)
    const blocked = ["extensions", "range", "path", "lab", "method"] as const
    if (ids.some((id) => (blocked as readonly string[]).includes(id))) {
      return {
        ok: false,
        error: `Wizard already complete — do not re-ask ${ids.join(", ")}.`,
        assistant_hint: progress.nextAskHint,
      }
    }
    return { ok: true }
  }

  const ids = promptQuestionIds(prompt)
  if (ids.includes(progress.nextStep)) {
    // Prefer bundled extensions+range+network; reject already-answered or out-of-phase extras.
    if (GOAD_PHASE1_BUNDLE.has(progress.nextStep as WizardStepId)) {
      const answered = new Set(progress.answeredIds)
      for (const id of ids) {
        if (id === progress.nextStep) continue
        if (progress.nextStep === "extensions" && id === "lab" && !answered.has("lab")) continue
        if (!GOAD_PHASE1_BUNDLE.has(id as WizardStepId)) {
          return {
            ok: false,
            error: `Wrong wizard step. Expected "${progress.nextStep}" (optionally bundled with unanswered extensions|range|network), got extra id="${id}".`,
            assistant_hint: progress.nextAskHint,
          }
        }
        if (answered.has(id)) {
          return {
            ok: false,
            error: `Already answered "${id}" — do not re-ask. Bundle only unanswered of extensions|range|network.`,
            assistant_hint: progress.nextAskHint,
          }
        }
      }
    }
    return { ok: true }
  }

  // Soft: allow lab only when next is extensions and lab not yet answered
  if (progress.nextStep === "extensions" && ids.includes("lab")) return { ok: true }

  return {
    ok: false,
    error: `Wrong wizard step. Expected ask_user question id="${progress.nextStep}" (or bundle with unanswered extensions|range|network), got: ${ids.join(", ") || "(none)"}.`,
    assistant_hint: progress.nextAskHint,
  }
}

/** Build continuation user text after an ask answer (cumulative + step hint). */
export function buildWizardContinueText(opts: {
  rows: AnsweredAskRow[]
  latestSummary: string
}): string {
  const all = formatAllAskAnswersForModel(opts.rows)
  const progress = deriveWizardProgress(opts.rows)
  const parts = [
    all || opts.latestSummary,
    "",
    progress.nextAskHint,
    "Prefer one ask_user card bundling unanswered of extensions+range+network when next is among those. " +
      "Separate cards for rangeID / network_yaml / confirm. Do not invent rangeID/name. " +
      "Only after confirm: createRange {rangeID,name} then executeGoad (GOAD lux path).",
  ]
  return parts.join("\n")
}

/** History message injected so the model sees all prior wizard answers. */
export function wizardAnswersHistoryContent(rows: AnsweredAskRow[]): string | null {
  const block = formatAllAskAnswersForModel(rows)
  if (!block.trim()) return null
  return (
    "Wizard answers so far (do NOT re-ask these; continue from the next unanswered step):\n" + block
  )
}

/** Dynamic prose→ask_user nudge when wizard mid-flight. */
export function proseAskNudgeForProgress(progress: WizardProgress): string {
  if (progress.flow === "none") {
    return (
      "STOP. You asked the user to choose options in chat text (numbered list / please provide). That is forbidden. " +
      "Call the ask_user tool NOW with button options. For GOAD deploy: read skills/ludus-ux/references/workflows/goad-deploy.md if needed, " +
      "then ask_user with path lux_goad vs ludus_blueprint (copy ids/labels from the playbook). " +
      "Do not write another prose question list. Do not call other tools until ask_user is shown."
    )
  }
  return (
    "STOP. Prose questions are forbidden. Call ask_user NOW for the next wizard step only. " +
    progress.nextAskHint
  )
}

/** Test helper: build a fake answered ask row. */
export function answeredAskRow(
  title: string,
  questions: AskQuestion[],
  answers: AskAnswers,
): AnsweredAskRow {
  return {
    kind: "ask",
    title,
    questions,
    answers,
    resolved: "answered",
  }
}
