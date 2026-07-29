/**
 * Redact secrets from values shown in assistant chat / sent back into the LLM loop.
 */

const REDACTED = "[redacted]"

const SENSITIVE_KEY =
  /^(?:api[_-]?key|apikey|confirm[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|auth(?:orization)?|bearer|password|passwd|passphrase|secret|private[_-]?key|ssh[_-]?password|ssh[_-]?key|cookie(?:header)?|llm[_-]?api[_-]?key|x-api-key|wireguard[_-]?(?:config|key|private)?)$/i

/** JWT-shaped or long opaque tokens in free text. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?\b/g
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi
const KEY_VALUE_RE =
  /\b((?:api[_-]?key|apikey|confirm[_-]?token|password|passwd|secret|token|authorization|x-api-key)\s*[:=]\s*)(["']?)([^\s"',}\\]{8,})\2/gi

function redactString(s: string): string {
  return s
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(KEY_VALUE_RE, `$1$2${REDACTED}$2`)
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

/** Deep-clone with secrets replaced. Safe for JSON-ish values. */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 40) return value
  if (value == null) return value
  if (typeof value === "string") return redactString(value) as T
  if (typeof value !== "object") return value
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth + 1)) as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      out[k] = typeof v === "string" && v.length === 0 ? "" : REDACTED
      continue
    }
    out[k] = redactSecrets(v, depth + 1)
  }
  return out as T
}

/** Pretty-print JSON-ish values; multiline strings expand to real newlines (not `\n`). */
function formatDisplayValue(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent)
  const padN = "  ".repeat(indent + 1)

  if (value === null) return "null"
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  if (typeof value === "string") {
    if (!value.includes("\n")) return JSON.stringify(value)
    return `\n${value
      .split("\n")
      .map((line) => padN + line)
      .join("\n")}`
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    const items = value.map((v) => {
      const rendered = formatDisplayValue(v, indent + 1)
      return typeof v === "string" && v.includes("\n")
        ? `${padN}${rendered.trimStart()}`
        : `${padN}${rendered}`
    })
    return `[\n${items.join(",\n")}\n${pad}]`
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "{}"
    const lines = entries.map(([k, v]) => {
      const rendered = formatDisplayValue(v, indent + 1)
      if (typeof v === "string" && v.includes("\n")) {
        return `${padN}${JSON.stringify(k)}:${rendered}`
      }
      return `${padN}${JSON.stringify(k)}: ${rendered}`
    })
    return `{\n${lines.join(",\n")}\n${pad}}`
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Soften truncated / invalid JSON so embedded `\\n` still becomes line breaks. */
function softenRawJsonBody(body: string): string {
  return body.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
}

/** Turn stored `→ {…}` / `← {…}` tool detail into indented display text. */
export function prettyToolChatDetail(detail: string): string {
  const m = detail.match(/^([→←])\s([\s\S]*)$/u)
  if (!m) return detail
  const truncated = m[2].endsWith("…")
  const body = truncated ? m[2].slice(0, -1) : m[2]
  try {
    const parsed = JSON.parse(body) as unknown
    const pretty = formatDisplayValue(parsed, 0)
    return truncated ? `${m[1]}\n${pretty}…` : `${m[1]}\n${pretty}`
  } catch {
    const softened = softenRawJsonBody(body)
    return truncated ? `${m[1]}\n${softened}…` : `${m[1]}\n${softened}`
  }
}

const DEFAULT_TOOL_DETAIL_MAX = 12_000

/**
 * Format tool args/result for chat persistence: redact secrets, then stringify.
 * Truncates with an ellipsis marker when over maxChars.
 */
export function formatToolChatDetail(
  direction: "→" | "←",
  payload: unknown,
  maxChars = DEFAULT_TOOL_DETAIL_MAX,
): string {
  const safe = redactSecrets(payload)
  let body: string
  try {
    body = JSON.stringify(safe, null, 0)
  } catch {
    body = String(safe)
  }
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars - 1)}…`
  }
  return `${direction} ${body}`
}

