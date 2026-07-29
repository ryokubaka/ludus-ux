/**
 * Detect when the model asked for choices in chat prose instead of ask_user.
 * Small models (e.g. gpt-4o-mini) often do this under tool_choice=auto.
 */

import type { WizardProgress } from "@/lib/assistant/wizard-progress"
import { proseAskNudgeForProgress } from "@/lib/assistant/wizard-progress"

const NUMBERED_CHOICE =
  /(?:^|\n)\s*(?:\d+[\).]|[-*•])\s+\*?\*?(?:Extensions?|Range|Network|Path|Instance|How|Deploy|Config|Lab|Blueprint)/im

const PROSE_ASK =
  /(?:please\s+(?:provide|confirm|let\s+me\s+know|choose|select)|would\s+you\s+like|do\s+you\s+want|which\s+(?:path|option|method)|need\s+to\s+confirm\s+a\s+few)/i

const CHOICE_KEYWORDS =
  /(?:extensions?|network\s+config|range\s+name|ludus\s+blueprint|lux\s+goad|deploy\s+via|config\s+method)/i

/** True when assistant text looks like a clarifying multiple-choice ask in prose. */
export function looksLikeProseClarification(content: string | null | undefined): boolean {
  const text = (content || "").trim()
  if (text.length < 40 || text.length > 4000) return false
  if (!PROSE_ASK.test(text) && !NUMBERED_CHOICE.test(text)) return false
  // Prefer true when deploy/wizard vocabulary is present, or numbered list of questions.
  const numberedQs = (text.match(/(?:^|\n)\s*\d+[\).]\s+/g) || []).length
  if (numberedQs >= 2) return true
  return CHOICE_KEYWORDS.test(text) || NUMBERED_CHOICE.test(text)
}

/** Default nudge when no wizard progress is available. */
export const ASK_USER_PROSE_NUDGE = proseAskNudgeForProgress({
  flow: "none",
  answeredIds: [],
  nextStep: null,
  nextAskHint: "",
})

/** Prefer step-aware nudge when mid GOAD/range wizard. */
export function askUserProseNudge(progress?: WizardProgress | null): string {
  return proseAskNudgeForProgress(
    progress ?? { flow: "none", answeredIds: [], nextStep: null, nextAskHint: "" },
  )
}
