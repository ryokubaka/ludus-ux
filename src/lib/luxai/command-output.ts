import yaml from "js-yaml"

/** Turn JSON, YAML, Ansible debug, and a fixed-width table into Markdown. Other text stays as written. */
export function presentCommandOutput(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  if (!text) return ""
  const blocks = ansibleDebugBlocks(text)
  if (blocks.length > 0) {
    const host = /^PLAY \[(.+?)\]/m.exec(text)?.[1]?.replace(/\*+$/, "").trim()
    const recap = text.split("\n").filter((line) => /PLAY RECAP|\bfailed=[1-9]|\bfatal:|\bFAILED!/i.test(line)).join("\n")
    return [`${host ? `## ${host}` : ""}`, blocks.join("\n\n"), recap].filter(Boolean).join("\n\n")
  }
  return renderStructured(text) || fixedWidthMarkdown(text) || text
}

/** Markdown for a JSON or YAML document. Null when the text is ordinary prose. */
export function renderStructured(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const rendered = renderValue(JSON.parse(trimmed))
      if (rendered && rendered !== trimmed) return rendered
    } catch {
      // A leading brace is not always JSON.
    }
  }
  if (!looksLikeYaml(trimmed)) return null
  try {
    const doc = yaml.load(trimmed)
    if (doc == null || typeof doc !== "object") return null
    const rendered = renderValue(doc)
    return rendered && rendered !== trimmed ? rendered : null
  } catch {
    return null
  }
}

function ansibleDebugBlocks(text: string): string[] {
  const blocks: string[] = []
  const pattern = /=>\s*\{/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const start = match.index + match[0].lastIndexOf("{")
    const slice = sliceJsonObject(text, start)
    if (!slice) continue
    try {
      const rendered = renderValue(JSON.parse(slice))
      if (rendered) blocks.push(rendered)
    } catch {
      // Incomplete JSON stays in the original text when nothing else parses.
    }
  }
  return blocks
}

function sliceJsonObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === "\\") {
        escape = true
        continue
      }
      if (ch === "\"") inString = false
      continue
    }
    if (ch === "\"") {
      inString = true
      continue
    }
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function looksLikeYaml(text: string): boolean {
  if (text.startsWith("---")) return true
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean)
  const keys = lines.filter((line) => /^[A-Za-z0-9_-]+:\s+\S/.test(line) || /^-\s+\S/.test(line))
  return keys.length >= 2 && keys.length >= lines.length - 1
}

function renderValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return fixedWidthMarkdown(value) || value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return ""
    if (value.every(isRecord)) return tableFromRecords(value)
    return value.map((item) => nest("-", renderValue(item))).join("\n")
  }
  if (!isRecord(value)) return String(value)
  const entries = Object.entries(value)
  if (entries.length === 1 && typeof entries[0][1] === "string" && /^(msg|stdout|stderr|output|result)$/.test(entries[0][0])) {
    return renderValue(entries[0][1])
  }
  return entries.map(([key, item]) => nest(`- **${escapeCell(key)}**:`, renderValue(item))).join("\n")
}

function nest(prefix: string, body: string): string {
  if (!body) return prefix
  if (!body.includes("\n")) return `${prefix} ${body}`.trim()
  return `${prefix}\n${body.split("\n").map((line) => (line ? `  ${line}` : line)).join("\n")}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function tableFromRecords(rows: Record<string, unknown>[]): string {
  const headers: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key)
    }
  }
  return markdownTable(headers, rows.map((row) => headers.map((key) => cell(row[key]))))
}

function cell(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function fixedWidthMarkdown(text: string): string | null {
  const lines = text.split("\n")
  const sep = lines.findIndex((line) => /^\s*-{2,}(\s+-{2,})+\s*$/.test(line))
  if (sep < 1) return null
  const marks = [...lines[sep].matchAll(/-+/g)].map((mark) => mark.index ?? 0)
  if (marks.length < 2) return null
  const sliceRow = (line: string) => marks.map((start, index) => {
    const left = valueStart(line, start)
    const right = index + 1 < marks.length ? valueStart(line, marks[index + 1]) : line.length
    return line.slice(left, right).trim()
  })
  const headers = sliceRow(lines[sep - 1])
  const rows = lines.slice(sep + 1).map(sliceRow).filter((row) => row.some(Boolean))
  if (rows.length === 0 || headers.every((header) => !header)) return null
  return markdownTable(headers, rows)
}

/** A right-aligned number can start before its dashes. The cell begins at that number. */
function valueStart(line: string, dashStart: number): number {
  let start = Math.min(dashStart, line.length)
  while (start > 0 && line[start - 1] !== " ") start -= 1
  return start
}

function markdownTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.map(escapeCell).join(" | ")} |`
  const rule = `| ${headers.map(() => "---").join(" | ")} |`
  const body = rows.map((row) => `| ${headers.map((_, index) => escapeCell(row[index] ?? "")).join(" | ")} |`)
  return [head, rule, ...body].join("\n")
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ")
}
