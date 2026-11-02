/** Parse Ludus blueprint bulk share/unshare responses (multiple envelope shapes). */

export interface BlueprintBulkError {
  item: string
  reason: string
}

function unwrapBulkPayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null
  const o = data as Record<string, unknown>
  if (
    o.result != null &&
    typeof o.result === "object" &&
    !Array.isArray(o.result)
  ) {
    return o.result as Record<string, unknown>
  }
  return o
}

export function parseBlueprintBulkErrors(data: unknown): BlueprintBulkError[] {
  const payload = unwrapBulkPayload(data)
  if (!payload) return []

  const out: BlueprintBulkError[] = []

  const errors = payload.errors
  if (Array.isArray(errors)) {
    for (const e of errors) {
      if (!e || typeof e !== "object") continue
      const item = String((e as { item?: string }).item ?? "").trim()
      const reason = String((e as { reason?: string }).reason ?? "failed").trim()
      if (item) out.push({ item, reason })
    }
  }

  const results = payload.results
  if (Array.isArray(results)) {
    for (const row of results) {
      if (!row || typeof row !== "object") continue
      const r = row as { ok?: boolean; item?: string; reason?: string }
      if (r.ok !== false) continue
      out.push({
        item: String(r.item ?? "?").trim() || "?",
        reason: String(r.reason ?? "failed").trim() || "failed",
      })
    }
  }

  return out
}

export function parseBlueprintBulkSuccess(data: unknown): string[] {
  const payload = unwrapBulkPayload(data)
  if (!payload) return []

  const success = payload.success
  if (!Array.isArray(success)) return []
  return success.map((s) => String(s).trim()).filter(Boolean)
}

export function blueprintBulkHadFailures(data: unknown): boolean {
  return parseBlueprintBulkErrors(data).length > 0
}
