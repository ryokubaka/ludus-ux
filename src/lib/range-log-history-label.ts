import type { LogHistoryEntry } from "@/lib/types"
import { LUDUS_DEPLOY_TAGS } from "@/lib/ludus-deploy-tags"
import { isNetworkOnlyTagDeploy } from "@/lib/goad-deploy-history-correlation"
import type { LuxRangeDeployTagRun, LuxRangeTestingEvent, RangeLogMarkerEnrichment } from "@/lib/range-log-marker-types"

/** Ludus may add fields over time — read without widening the public TS type. */
type LogHistoryEntryExt = LogHistoryEntry & {
  opType?: string
  kind?: string
  operation?: string
  name?: string
}

function normToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_")
}

function tagsFromTemplate(template: string | undefined | null): string[] {
  if (!template?.trim()) return []
  return template.split(",").map((t) => t.trim()).filter(Boolean)
}

const FULL_TAG_SET = new Set(LUDUS_DEPLOY_TAGS.map((t) => t.toLowerCase()))

/** True when `tags` is exactly the known full Ludus deploy tag set (any order). */
export function isFullDeployTagSet(tags: string[]): boolean {
  if (tags.length !== LUDUS_DEPLOY_TAGS.length) return false
  const lower = new Set(tags.map((t) => t.trim().toLowerCase()))
  if (lower.size !== FULL_TAG_SET.size) return false
  for (const t of FULL_TAG_SET) {
    if (!lower.has(t)) return false
  }
  return true
}

const MATCH_BEFORE_MS = 25_000
const MATCH_AFTER_MS = 18 * 60_000

/** Ludus deploy history rows are not tied to LUX testing toggles; avoid time-window false positives. */
function testingLabelFromLux(entry: LogHistoryEntry, events: LuxRangeTestingEvent[]): string | null {
  if (!events.length) return null
  for (const e of events) {
    if (e.ludusLogId && e.ludusLogId === entry.id) {
      if (e.opType === "testing_start") return "Testing Mode: Turn On"
      if (e.opType === "testing_stop") return "Testing Mode: Turn Off"
      return null
    }
  }
  return null
}

function deployTagsFromLux(entry: LogHistoryEntry, runs: LuxRangeDeployTagRun[]): string | null {
  if (!runs.length) return null
  const t = new Date(entry.start).getTime()
  if (Number.isNaN(t)) return null
  for (const r of runs) {
    if (r.ludusLogId === entry.id) return r.tagsCsv
  }
  let best: { dist: number; tags: string } | null = null
  for (const r of runs) {
    if (r.ludusLogId) continue
    if (t >= r.requestedAt - MATCH_BEFORE_MS && t <= r.requestedAt + MATCH_AFTER_MS) {
      const dist = Math.abs(t - r.requestedAt)
      if (!best || dist < best.dist) best = { dist, tags: r.tagsCsv }
    }
  }
  return best?.tags ?? null
}

/**
 * One-line description for Range Logs / Deploy History rows (non-GOAD title).
 * Uses `template`, optional LUX SQLite markers, and optional Ludus meta fields.
 */
export function rangeLogHistoryListPrimary(
  entry: LogHistoryEntry,
  enrichment?: RangeLogMarkerEnrichment | null,
): string {
  const luxTesting = enrichment?.testingEvents?.length
    ? testingLabelFromLux(entry, enrichment.testingEvents)
    : null
  if (luxTesting) return luxTesting

  const luxTags = enrichment?.deployTagRuns?.length
    ? deployTagsFromLux(entry, enrichment.deployTagRuns)
    : null
  if (luxTags) {
    const line = `Deploy Tags: ${luxTags}`
    return line.length > 120 ? `${line.slice(0, 117)}…` : line
  }

  const ext = entry as LogHistoryEntryExt
  const meta = String(ext.opType || ext.kind || ext.operation || "").trim()
  const metaN = normToken(meta)

  if (metaN.includes("testing_start") || metaN === "testingstart") {
    return "Testing Mode: Turn On"
  }
  if (metaN.includes("testing_stop") || metaN === "testingstop") {
    return "Testing Mode: Turn Off"
  }

  const raw = entry.template?.trim() ?? ""
  const rawN = normToken(raw)

  if (
    rawN === "testing_start" ||
    rawN === "testing/start" ||
    rawN === "testing_on" ||
    rawN === "testing:on"
  ) {
    return "Testing Mode: Turn On"
  }
  if (
    rawN === "testing_stop" ||
    rawN === "testing/stop" ||
    rawN === "testing_off" ||
    rawN === "testing:off" ||
    rawN === "testing_end"
  ) {
    return "Testing Mode: Turn Off"
  }

  if (!raw) {
    return "Deploy"
  }

  if (isNetworkOnlyTagDeploy(entry)) {
    return "Deploy Tags: network"
  }

  const tags = tagsFromTemplate(raw)
  if (tags.length === 0) {
    return "Deploy"
  }

  if (isFullDeployTagSet(tags)) {
    return "Deploy: Full Deployment"
  }

  const joined = tags.join(", ")
  const line = `Deploy Tags: ${joined}`
  return line.length > 120 ? `${line.slice(0, 117)}…` : line
}
