/**
 * Human-readable preview of a pending destructive API call for the confirm UI.
 */

const MAX_DETAIL_CHARS = 1_200

function truncate(s: string, max = MAX_DETAIL_CHARS): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function formatValue(v: unknown, indent = 0): string {
  const pad = "  ".repeat(indent)
  if (v === null || v === undefined) return `${pad}(none)`
  if (typeof v === "string") {
    if (v.length > 200) return `${pad}${JSON.stringify(v.slice(0, 180) + "…")}`
    return `${pad}${JSON.stringify(v)}`
  }
  if (typeof v === "number" || typeof v === "boolean") return `${pad}${String(v)}`
  if (Array.isArray(v)) {
    if (v.length === 0) return `${pad}[]`
    // Compact string arrays (template names, etc.)
    if (v.every((x) => typeof x === "string")) {
      return v.map((x) => `${pad}- ${x}`).join("\n")
    }
    return v
      .slice(0, 20)
      .map((x, i) => `${pad}- [${i}]\n${formatValue(x, indent + 1)}`)
      .join("\n")
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(
      ([k]) => k !== "confirmToken" && k !== "operationId",
    )
    if (entries.length === 0) return `${pad}{}`
    return entries
      .map(([k, val]) => {
        if (val !== null && typeof val === "object") {
          return `${pad}${k}:\n${formatValue(val, indent + 1)}`
        }
        return `${pad}${k}: ${formatValue(val, 0).trim()}`
      })
      .join("\n")
  }
  return `${pad}${String(v)}`
}

/** Short title line for confirm cards. */
export function formatConfirmSummary(
  method: string,
  path: string,
  operationId: string,
): string {
  return `${method.toUpperCase()} ${path} (${operationId})`
}

/**
 * Detail block shown under the confirm title so the user sees body/query/path params.
 */
export function formatConfirmDetail(args: Record<string, unknown> | undefined): string {
  if (!args || typeof args !== "object") return ""
  const parts: string[] = []

  const pathParams =
    (args.pathParams as Record<string, unknown> | undefined) ||
    (args.params as Record<string, unknown> | undefined)
  if (pathParams && typeof pathParams === "object" && Object.keys(pathParams).length > 0) {
    parts.push(`Path params:\n${formatValue(pathParams, 1)}`)
  }

  const query = args.query
  if (query && typeof query === "object" && Object.keys(query as object).length > 0) {
    parts.push(`Query:\n${formatValue(query, 1)}`)
  }

  if (args.body !== undefined) {
    parts.push(`Body:\n${formatValue(args.body, 1)}`)
  } else {
    // Some callers put fields at top level besides operationId
    const rest = { ...args }
    delete rest.operationId
    delete rest.confirmToken
    delete rest.pathParams
    delete rest.params
    delete rest.query
    if (Object.keys(rest).length > 0) {
      parts.push(`Args:\n${formatValue(rest, 1)}`)
    }
  }

  return truncate(parts.join("\n\n"))
}
