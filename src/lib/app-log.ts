/**
 * Durable application + auth event logging (SQLite + stdout + SSE pub/sub).
 */

import { randomUUID } from "crypto"
import { getDb } from "@/lib/db"

export type LogCategory = "auth" | "app"
export type LogLevel = "info" | "warn" | "error"
export type LogOutcome = "success" | "failure" | "blocked"

export interface AppLogRow {
  id: string
  ts: number
  category: LogCategory
  level: LogLevel
  event: string
  outcome: string | null
  username: string | null
  ip: string | null
  detail: string | null
}

export interface WriteAppLogInput {
  category: LogCategory
  event: string
  level?: LogLevel
  outcome?: LogOutcome | null
  username?: string | null
  ip?: string | null
  detail?: string | null
  ts?: number
  id?: string
}

type LogSubscriber = (line: string) => void

const g = global as typeof global & { __luxAppLogSubs?: Set<LogSubscriber> }
if (!g.__luxAppLogSubs) g.__luxAppLogSubs = new Set()
const subscribers = g.__luxAppLogSubs

export function subscribeAppLogEvents(cb: LogSubscriber): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

export function formatAppLogLine(row: Pick<AppLogRow, "ts" | "category" | "event" | "outcome" | "username" | "ip" | "detail">): string {
  const ts = new Date(row.ts).toISOString()
  const cat = row.category.toUpperCase()
  const parts: string[] = [`[${ts}]`, `[${cat}]`, row.event]
  if (row.outcome) parts.push(row.outcome)
  if (row.username) parts.push(`user=${row.username}`)
  if (row.ip) parts.push(`ip=${row.ip}`)
  if (row.detail) parts.push(row.detail)
  return parts.join(" ")
}

export function writeAppLog(input: WriteAppLogInput): AppLogRow {
  const row: AppLogRow = {
    id: input.id ?? randomUUID(),
    ts: input.ts ?? Date.now(),
    category: input.category,
    level: input.level ?? "info",
    event: input.event,
    outcome: input.outcome ?? null,
    username: input.username ?? null,
    ip: input.ip ?? null,
    detail: input.detail ?? null,
  }

  try {
    getDb()
      .prepare(
        `INSERT INTO lux_app_logs (id, ts, category, level, event, outcome, username, ip, detail)
         VALUES (@id, @ts, @category, @level, @event, @outcome, @username, @ip, @detail)`,
      )
      .run(row)
  } catch (err) {
    console.warn("[app-log] insert failed:", err instanceof Error ? err.message : String(err))
  }

  const line = formatAppLogLine(row)
  console.log(line)
  for (const sub of subscribers) {
    try {
      sub(line)
    } catch {
      /* ignore subscriber errors */
    }
  }
  return row
}

export function logAppEvent(
  event: string,
  detail?: string,
  opts: {
    username?: string
    ip?: string
    level?: LogLevel
    outcome?: LogOutcome
  } = {},
): void {
  writeAppLog({
    category: "app",
    event,
    detail: detail ?? null,
    username: opts.username ?? null,
    ip: opts.ip ?? null,
    level: opts.level ?? "info",
    outcome: opts.outcome ?? null,
  })
}

export function queryAppLogs(opts: {
  category?: LogCategory
  limit?: number
  before?: number
}): AppLogRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500)
  const params: (string | number)[] = []
  let sql = `SELECT id, ts, category, level, event, outcome, username, ip, detail
             FROM lux_app_logs WHERE 1=1`

  if (opts.category) {
    sql += ` AND category = ?`
    params.push(opts.category)
  }
  if (opts.before != null) {
    sql += ` AND ts < ?`
    params.push(opts.before)
  }

  sql += ` ORDER BY ts DESC LIMIT ?`
  params.push(limit)

  return getDb().prepare(sql).all(...params) as AppLogRow[]
}
