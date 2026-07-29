/**
 * Format assistant chat rows for clipboard export (debugging / paste to support).
 */

import { prettyToolChatDetail } from "@/lib/assistant/redact-secrets"
import type { AskAnswers, AskQuestion } from "@/lib/assistant/ask-user"

export type SessionCopyRow =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | {
      kind: "confirm"
      summary: string
      detail?: string
      resolved?: string
    }
  | {
      kind: "ask"
      title: string
      message?: string
      questions: AskQuestion[]
      resolved?: string
      answers?: AskAnswers
    }
  | { kind: "status"; text: string }
  | { kind: "thinking"; text: string }

function formatAskAnswers(questions: AskQuestion[], answers?: AskAnswers): string {
  if (!answers) return "(no answers)"
  const lines: string[] = []
  for (const q of questions) {
    const a = answers[q.id]
    const parts: string[] = []
    if (a?.selected?.length) parts.push(a.selected.join(", "))
    if (a?.text) parts.push(`text: ${a.text}`)
    lines.push(`  - ${q.id}: ${parts.join(" · ") || "(empty)"}`)
  }
  return lines.join("\n")
}

export function formatAssistantSessionForCopy(opts: {
  title?: string
  conversationId?: string
  rows: SessionCopyRow[]
  exportedAt?: Date
}): string {
  const when = (opts.exportedAt || new Date()).toISOString()
  const lines: string[] = [
    "# LUX Assistant session",
    `Title: ${opts.title || "Conversation"}`,
    opts.conversationId ? `Conversation-Id: ${opts.conversationId}` : "",
    `Exported: ${when}`,
    "",
  ].filter(Boolean)

  for (const r of opts.rows) {
    switch (r.kind) {
      case "user":
        lines.push("## User", r.text, "")
        break
      case "assistant":
        lines.push("## Assistant", r.text, "")
        break
      case "thinking":
        lines.push("## Thinking", r.text, "")
        break
      case "status":
        lines.push(`## Status`, r.text, "")
        break
      case "tool":
        lines.push(`## Tool: ${r.name}`, prettyToolChatDetail(r.detail), "")
        break
      case "confirm":
        lines.push(
          `## Confirm (${r.resolved || "pending"})`,
          r.summary,
          r.detail ? r.detail : "",
          "",
        )
        break
      case "ask":
        lines.push(
          `## Ask: ${r.title} (${r.resolved || "pending"})`,
          r.message || "",
          "Questions:",
          ...r.questions.map(
            (q) =>
              `  - ${q.id} [${q.type}]: ${q.prompt}` +
              (q.options?.length ? ` options=[${q.options.map((o) => o.id).join("|")}]` : ""),
          ),
          r.resolved === "answered" ? "Answers:" : "",
          r.resolved === "answered" ? formatAskAnswers(r.questions, r.answers) : "",
          "",
        )
        break
      default:
        break
    }
  }

  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").trim() + "\n"
}
