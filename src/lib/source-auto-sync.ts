import "server-only"

import { resolveGlobalBlueprintServiceApiKey } from "@/lib/blueprint-global-install"
import {
  listSources,
  syncSource,
  type LudusSourceRow,
} from "@/lib/ludus-source-client"

const DEFAULT_INTERVAL_MS = 5 * 60_000
const MIN_INTERVAL_MS = 60_000

const inflight = new Map<string, Promise<boolean>>()

type AutoSyncGlobal = typeof globalThis & {
  __luxSourceAutoSyncStarted?: boolean
  __luxSourceAutoSyncTimer?: ReturnType<typeof setInterval>
  __luxSourceAutoSyncNoKeyWarned?: boolean
}

export function sourceAutoSyncEnabled(): boolean {
  const v = (process.env.SOURCE_AUTO_SYNC_ENABLED ?? "true").trim().toLowerCase()
  return v !== "0" && v !== "false" && v !== "off" && v !== "no"
}

/** How often LUX re-pulls git-backed Ludus sources (default 5m, min 1m). */
export function sourceAutoSyncIntervalMs(): number {
  const raw = process.env.SOURCE_AUTO_SYNC_INTERVAL_MS
  const n = raw != null && raw !== "" ? Number(raw) : DEFAULT_INTERVAL_MS
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_MS
  return Math.max(MIN_INTERVAL_MS, Math.floor(n))
}

export function sourceIdOf(row: LudusSourceRow): string {
  return (row.sourceID || row.id || "").trim()
}

export function isGitBackedSource(row: LudusSourceRow): boolean {
  const kind = (row.type || row.kind || "git").trim().toLowerCase()
  if (kind === "upload") return false
  return !!row.url?.trim()
}

export function parseSourceSyncedAtMs(lastSyncedAt?: string | null): number | null {
  const raw = (lastSyncedAt ?? "").trim()
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

/** True when Ludus should re-pull this source's git working tree. */
export function isSourceSyncStale(
  row: LudusSourceRow,
  nowMs: number = Date.now(),
  maxAgeMs: number = sourceAutoSyncIntervalMs(),
): boolean {
  if (!sourceAutoSyncEnabled()) return false
  if (!isGitBackedSource(row)) return false
  const status = (row.lastSyncStatus || "").trim().toLowerCase()
  if (status === "error" || status === "pending") return true
  const syncedAt = parseSourceSyncedAtMs(row.lastSyncedAt)
  if (syncedAt == null) return true
  return nowMs - syncedAt >= maxAgeMs
}

/**
 * Sync one git source when stale. Dedupes concurrent callers.
 * Returns true when a sync ran successfully.
 */
export async function ensureSourceFresh(
  apiKey: string,
  source: LudusSourceRow,
  opts?: { force?: boolean; maxAgeMs?: number },
): Promise<boolean> {
  if (!sourceAutoSyncEnabled() && !opts?.force) return false
  if (!isGitBackedSource(source)) return false
  const sid = sourceIdOf(source)
  if (!sid || !apiKey.trim()) return false

  const stale =
    opts?.force ||
    isSourceSyncStale(source, Date.now(), opts?.maxAgeMs ?? sourceAutoSyncIntervalMs())
  if (!stale) return false

  const existing = inflight.get(sid)
  if (existing) return existing

  const run = (async () => {
    try {
      await syncSource(apiKey, sid, {})
      console.log(`[source-auto-sync] synced ${sid}`)
      return true
    } catch (err) {
      console.warn(
        `[source-auto-sync] sync failed source=${sid}:`,
        err instanceof Error ? err.message : err,
      )
      return false
    } finally {
      inflight.delete(sid)
    }
  })()

  inflight.set(sid, run)
  return run
}

/** Sync all stale git sources visible to this API key. */
export async function ensureSourcesFresh(
  apiKey: string,
  sources: LudusSourceRow[],
  opts?: { force?: boolean; maxAgeMs?: number },
): Promise<{ attempted: number; synced: number }> {
  const targets = sources.filter((s) => sourceIdOf(s) && isGitBackedSource(s))
  let attempted = 0
  let synced = 0
  for (const source of targets) {
    if (!opts?.force && !isSourceSyncStale(source, Date.now(), opts?.maxAgeMs)) continue
    attempted += 1
    if (await ensureSourceFresh(apiKey, source, opts)) synced += 1
  }
  return { attempted, synced }
}

/** Background pass: list + sync stale sources with the stored service/admin key. */
export async function runSourceAutoSyncPass(): Promise<void> {
  if (!sourceAutoSyncEnabled()) return
  const apiKey = resolveGlobalBlueprintServiceApiKey()
  if (!apiKey) {
    const g = globalThis as AutoSyncGlobal
    if (!g.__luxSourceAutoSyncNoKeyWarned) {
      g.__luxSourceAutoSyncNoKeyWarned = true
      console.warn(
        "[source-auto-sync] background loop idle until an admin session is stored (open Sources or install a source blueprint as admin). Per-user catalog views still auto-sync with the caller key.",
      )
    }
    return
  }
  try {
    const sources = await listSources(apiKey)
    const { attempted, synced } = await ensureSourcesFresh(apiKey, sources)
    if (attempted > 0) {
      console.log(`[source-auto-sync] pass done attempted=${attempted} synced=${synced}`)
    }
  } catch (err) {
    console.warn(
      "[source-auto-sync] pass failed:",
      err instanceof Error ? err.message : err,
    )
  }
}

/** Start interval loop once per Node process (Docker / long-lived Next server). */
export function startSourceAutoSyncLoop(): void {
  if (!sourceAutoSyncEnabled()) return
  const g = globalThis as AutoSyncGlobal
  if (g.__luxSourceAutoSyncStarted) return
  g.__luxSourceAutoSyncStarted = true

  const intervalMs = sourceAutoSyncIntervalMs()
  console.log(
    `[source-auto-sync] enabled interval=${Math.round(intervalMs / 1000)}s`,
  )

  // First pass shortly after start (let settings/DB settle).
  setTimeout(() => {
    void runSourceAutoSyncPass()
  }, 15_000)

  g.__luxSourceAutoSyncTimer = setInterval(() => {
    void runSourceAutoSyncPass()
  }, intervalMs)
  g.__luxSourceAutoSyncTimer.unref?.()
}

/** Idempotent — call from long-lived request handlers when instrumentation may not run. */
export function ensureSourceAutoSyncLoopStarted(): void {
  startSourceAutoSyncLoop()
}
