import { randomUUID } from "node:crypto"
import type BetterSqlite3 from "better-sqlite3"
import { getDb } from "@/lib/core/db"
import {
  decryptSettingsValueAtRest,
  encryptSettingsValueAtRest,
} from "@/lib/settings/settings-value-at-rest"
import { CURSOR_API_ORIGIN } from "@/lib/luxai/cursor"
import { DEFAULT_LUXAI_PROMPT, LUXAI_CONTEXT_WINDOWS, LUXAI_EFFORTS, LUXAI_LIMITS } from "@/lib/luxai/defaults"
import { cleanCatalog, cleanModelParams } from "@/lib/luxai/providers"
import type {
  LuxaiChangeKind,
  LuxaiChangeStatus,
  LuxaiChangeView,
  LuxaiChoice,
  LuxaiEgress,
  LuxaiMessageView,
  LuxaiModelInfo,
  LuxaiProvider,
  LuxaiPublicSettings,
  LuxaiSessionSummary,
} from "@/lib/luxai/types"

let testDb: BetterSqlite3.Database | null = null

/** Unit tests pass an isolated database. Production uses the LUX sqlite file. */
export function bindLuxaiDbForTests(db: BetterSqlite3.Database | null): void {
  testDb = db
  if (db) ensureLuxaiTables(db)
}

function database(): BetterSqlite3.Database {
  const db = testDb ?? getDb()
  ensureLuxaiTables(db)
  return db
}

function ensureLuxaiTables(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS luxai_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS luxai_sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_luxai_sessions_user ON luxai_sessions(username, updated_at DESC);
    CREATE TABLE IF NOT EXISTS luxai_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_luxai_messages_session ON luxai_messages(session_id, created_at);
    CREATE TABLE IF NOT EXISTS luxai_changes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      username TEXT NOT NULL,
      range_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      preview TEXT NOT NULL,
      before_text TEXT NOT NULL,
      after_text TEXT NOT NULL,
      revertable INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      applied_at INTEGER,
      reverted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_luxai_changes_session ON luxai_changes(session_id, created_at);
    CREATE TABLE IF NOT EXISTS luxai_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      username TEXT NOT NULL,
      status TEXT NOT NULL,
      steer TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  const messageColumns = db.prepare("PRAGMA table_info(luxai_messages)").all() as Array<{ name: string }>
  if (!messageColumns.some((column) => column.name === "reasoning")) {
    db.exec("ALTER TABLE luxai_messages ADD COLUMN reasoning TEXT")
  }
  const runColumns = db.prepare("PRAGMA table_info(luxai_runs)").all() as Array<{ name: string }>
  if (!runColumns.some((column) => column.name === "answer")) {
    db.exec("ALTER TABLE luxai_runs ADD COLUMN answer TEXT")
  }
  if (!runColumns.some((column) => column.name === "choice")) {
    db.exec("ALTER TABLE luxai_runs ADD COLUMN choice TEXT")
  }
  const sessionColumns = db.prepare("PRAGMA table_info(luxai_sessions)").all() as Array<{ name: string }>
  if (!sessionColumns.some((column) => column.name === "archived")) {
    db.exec("ALTER TABLE luxai_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
  }
}

function appSecret(): string {
  return process.env.APP_SECRET || "change-me-in-production-32-chars!!"
}

export interface LuxaiSettings {
  enabled: boolean
  provider: LuxaiProvider
  egress: LuxaiEgress
  baseUrl: string
  model: string
  apiKey: string
  effort: string
  contextWindow: number
  modelParams: Array<{ id: string; value: string }>
  modelCatalog: LuxaiModelInfo[]
  maxRounds: number
  maxToolCalls: number
  timeoutSec: number
  systemPrompt: string
}

const DEFAULT_SETTINGS: LuxaiSettings = {
  enabled: false,
  provider: "openai",
  egress: "local",
  baseUrl: "",
  model: "",
  apiKey: "",
  effort: "",
  contextWindow: 0,
  modelParams: [],
  modelCatalog: [],
  maxRounds: 8,
  maxToolCalls: 12,
  timeoutSec: 120,
  systemPrompt: "",
}

function readSetting(key: string): string | null {
  const row = database().prepare("SELECT value FROM luxai_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function writeSetting(key: string, value: string): void {
  database()
    .prepare(
      `INSERT INTO luxai_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, Date.now())
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function readInt(key: string, fallback: number, min: number, max: number): number {
  const raw = readSetting(key)
  if (raw == null || raw.trim() === "") return fallback
  return clampInt(Number(raw), min, max, fallback)
}

function readProvider(raw: string | null): LuxaiProvider {
  if (raw === "anthropic" || raw === "cursor") return raw
  return "openai"
}

function readEffort(raw: string | null): string {
  return LUXAI_EFFORTS.includes(raw as (typeof LUXAI_EFFORTS)[number]) ? raw || "" : ""
}

function readContext(raw: string | null): number {
  const value = Number(raw)
  return LUXAI_CONTEXT_WINDOWS.includes(value as (typeof LUXAI_CONTEXT_WINDOWS)[number]) ? value : 0
}

function readJson<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  const raw = readSetting(key)
  if (!raw) return fallback
  try {
    return parse(JSON.parse(raw))
  } catch {
    return fallback
  }
}

export function getLuxaiSettings(): LuxaiSettings {
  const enabled = readSetting("enabled") === "true"
  const provider = readProvider(readSetting("provider"))
  const egress = provider === "cursor" || readSetting("egress") === "cloud" ? "cloud" : "local"
  const storedKey = readSetting("apiKey") ?? ""
  let apiKey = ""
  if (storedKey) {
    try {
      apiKey = decryptSettingsValueAtRest(storedKey, appSecret())
    } catch {
      apiKey = ""
    }
  }
  return {
    enabled,
    provider,
    egress,
    baseUrl: provider === "cursor" ? CURSOR_API_ORIGIN : (readSetting("baseUrl") ?? ""),
    model: readSetting("model") ?? "",
    apiKey,
    effort: readEffort(readSetting("effort")),
    contextWindow: readContext(readSetting("contextWindow")),
    modelParams: readJson("modelParams", cleanModelParams, []),
    modelCatalog: readJson("modelCatalog", cleanCatalog, []),
    maxRounds: readInt("maxRounds", DEFAULT_SETTINGS.maxRounds, 1, 30),
    maxToolCalls: readInt("maxToolCalls", DEFAULT_SETTINGS.maxToolCalls, 1, 40),
    timeoutSec: readInt("timeoutSec", DEFAULT_SETTINGS.timeoutSec, 5, 600),
    systemPrompt: readSetting("systemPrompt") ?? "",
  }
}

export function luxaiReady(settings: LuxaiSettings): boolean {
  if (!settings.enabled) return false
  if (!settings.baseUrl.trim() || !settings.model.trim()) return false
  if (settings.egress === "cloud" && !settings.apiKey.trim()) return false
  return true
}

export function toPublicLuxaiSettings(settings: LuxaiSettings, canConfigure: boolean): LuxaiPublicSettings {
  const prompt = settings.systemPrompt.trim()
  return {
    enabled: settings.enabled,
    ready: luxaiReady(settings),
    provider: settings.provider,
    egress: settings.egress,
    baseUrl: canConfigure ? settings.baseUrl : "",
    model: settings.model,
    apiKeySet: settings.apiKey.trim().length > 0,
    effort: settings.effort,
    contextWindow: settings.contextWindow,
    modelParams: settings.modelParams,
    catalog: canConfigure ? settings.modelCatalog : [],
    maxRounds: settings.maxRounds,
    maxToolCalls: settings.maxToolCalls,
    timeoutSec: settings.timeoutSec,
    systemPrompt: canConfigure ? (prompt || DEFAULT_LUXAI_PROMPT) : "",
    promptIsDefault: prompt.length === 0,
    canConfigure,
  }
}

export interface LuxaiSettingsPatch {
  enabled?: boolean
  provider?: LuxaiProvider
  egress?: LuxaiEgress
  baseUrl?: string
  model?: string
  apiKey?: string
  clearKey?: boolean
  effort?: string
  contextWindow?: number
  modelParams?: Array<{ id: string; value: string }>
  modelCatalog?: LuxaiModelInfo[]
  maxRounds?: number
  maxToolCalls?: number
  timeoutSec?: number
  systemPrompt?: string
  resetPrompt?: boolean
}

export function saveLuxaiSettings(current: LuxaiSettings, patch: LuxaiSettingsPatch): LuxaiSettings {
  const next: LuxaiSettings = { ...current }
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled
  if (patch.provider === "openai" || patch.provider === "anthropic" || patch.provider === "cursor") next.provider = patch.provider
  if (patch.egress === "local" || patch.egress === "cloud") next.egress = patch.egress
  if (typeof patch.baseUrl === "string") next.baseUrl = patch.baseUrl.trim()
  if (typeof patch.model === "string") next.model = patch.model.trim()
  if (typeof patch.effort === "string") next.effort = readEffort(patch.effort)
  if (typeof patch.contextWindow === "number") next.contextWindow = readContext(String(patch.contextWindow))
  if (patch.modelParams) next.modelParams = cleanModelParams(patch.modelParams)
  if (next.provider === "cursor") {
    next.baseUrl = CURSOR_API_ORIGIN
    next.egress = "cloud"
  }
  if (typeof patch.maxRounds === "number") next.maxRounds = clampInt(patch.maxRounds, 1, 30, current.maxRounds)
  if (typeof patch.maxToolCalls === "number") next.maxToolCalls = clampInt(patch.maxToolCalls, 1, 40, current.maxToolCalls)
  if (typeof patch.timeoutSec === "number") next.timeoutSec = clampInt(patch.timeoutSec, 5, 600, current.timeoutSec)
  if (patch.resetPrompt) next.systemPrompt = ""
  else if (typeof patch.systemPrompt === "string") next.systemPrompt = patch.systemPrompt.slice(0, 20_000)

  const endpointChanged =
    next.baseUrl !== current.baseUrl || next.provider !== current.provider || next.egress !== current.egress
  if (patch.modelCatalog) next.modelCatalog = cleanCatalog(patch.modelCatalog)
  else if (endpointChanged) next.modelCatalog = []
  if (endpointChanged && !patch.modelParams) next.modelParams = []
  if (patch.clearKey) next.apiKey = ""
  else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim()
  else if (endpointChanged) next.apiKey = ""

  if (next.enabled && (!next.baseUrl || !next.model)) {
    throw new Error("Set a model URL and a model name before enabling LUXAI.")
  }
  if (next.enabled && next.egress === "cloud" && !next.apiKey) {
    throw new Error("A cloud provider needs an API key.")
  }

  writeSetting("enabled", next.enabled ? "true" : "false")
  writeSetting("provider", next.provider)
  writeSetting("egress", next.egress)
  writeSetting("baseUrl", next.baseUrl)
  writeSetting("model", next.model)
  writeSetting("effort", next.effort)
  writeSetting("contextWindow", String(next.contextWindow))
  writeSetting("modelParams", JSON.stringify(next.modelParams))
  writeSetting("modelCatalog", JSON.stringify(next.modelCatalog))
  writeSetting("maxRounds", String(next.maxRounds))
  writeSetting("maxToolCalls", String(next.maxToolCalls))
  writeSetting("timeoutSec", String(next.timeoutSec))
  writeSetting("systemPrompt", next.systemPrompt)
  writeSetting("apiKey", next.apiKey ? encryptSettingsValueAtRest(next.apiKey, appSecret()) : "")
  return next
}

export function createSession(username: string, title: string): LuxaiSessionSummary {
  const now = Date.now()
  const row: LuxaiSessionSummary = {
    id: randomUUID(),
    title: title.trim().slice(0, 80) || "New chat",
    updatedAt: now,
    archived: false,
    runStatus: null,
  }
  database()
    .prepare("INSERT INTO luxai_sessions (id, username, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, username, row.title, now, now)
  return row
}

export function listSessions(username: string): LuxaiSessionSummary[] {
  const rows = database()
    .prepare(
      `SELECT s.id, s.title, s.updated_at AS updatedAt, s.archived AS archived,
              (
                SELECT status FROM luxai_runs
                WHERE session_id = s.id
                ORDER BY created_at DESC
                LIMIT 1
              ) AS runStatus
       FROM luxai_sessions s
       WHERE s.username = ?
       ORDER BY s.updated_at DESC
       LIMIT 50`,
    )
    .all(username) as Array<{ id: string; title: string; updatedAt: number; archived: number | null; runStatus: string | null }>
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    archived: row.archived === 1,
    runStatus: row.runStatus === "running" || row.runStatus === "paused" || row.runStatus === "done" || row.runStatus === "stopped"
      ? row.runStatus
      : null,
  }))
}

export function sessionOwned(username: string, sessionId: string): boolean {
  const row = database()
    .prepare("SELECT id FROM luxai_sessions WHERE id = ? AND username = ?")
    .get(sessionId, username) as { id: string } | undefined
  return !!row
}

export function setSessionArchived(username: string, sessionId: string, archived: boolean): boolean {
  if (!sessionOwned(username, sessionId)) return false
  const result = database()
    .prepare("UPDATE luxai_sessions SET archived = ? WHERE id = ? AND username = ?")
    .run(archived ? 1 : 0, sessionId, username)
  return result.changes === 1
}

export function renameSession(username: string, sessionId: string, title: string): string | null {
  if (!sessionOwned(username, sessionId)) return null
  const next = title.trim().slice(0, 80)
  if (!next) return null
  const result = database()
    .prepare("UPDATE luxai_sessions SET title = ?, updated_at = ? WHERE id = ? AND username = ?")
    .run(next, Date.now(), sessionId, username)
  return result.changes === 1 ? next : null
}

export function touchSession(sessionId: string): void {
  database().prepare("UPDATE luxai_sessions SET updated_at = ? WHERE id = ?").run(Date.now(), sessionId)
}

export function deleteSession(username: string, sessionId: string): boolean {
  if (!sessionOwned(username, sessionId)) return false
  const db = database()
  const run = db.transaction(() => {
    db.prepare("DELETE FROM luxai_messages WHERE session_id = ?").run(sessionId)
    db.prepare("DELETE FROM luxai_runs WHERE session_id = ? AND username = ?").run(sessionId, username)
    db.prepare("DELETE FROM luxai_changes WHERE session_id = ? AND username = ?").run(sessionId, username)
    db.prepare("DELETE FROM luxai_sessions WHERE id = ? AND username = ?").run(sessionId, username)
  })
  run()
  return true
}

export function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  reasoning = "",
): LuxaiMessageView {
  const row: LuxaiMessageView = {
    id: randomUUID(),
    role,
    content,
    reasoning: reasoning.trim(),
    createdAt: Date.now(),
  }
  database()
    .prepare(
      "INSERT INTO luxai_messages (id, session_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(row.id, sessionId, role, content, row.reasoning || null, row.createdAt)
  touchSession(sessionId)
  return row
}

export function listMessages(sessionId: string): LuxaiMessageView[] {
  const rows = database()
    .prepare(
      "SELECT id, role, content, reasoning, created_at AS createdAt FROM luxai_messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId) as Array<LuxaiMessageView & { reasoning: string | null }>
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning || "",
    createdAt: row.createdAt,
  }))
}

export interface LuxaiRunControl {
  id: string
  status: "running" | "paused" | "stopped" | "done"
  steer: string
}

export function createRun(sessionId: string, username: string): string {
  const id = createRunIfIdle(sessionId, username)
  if (!id) throw new Error("This chat already has a run in progress.")
  return id
}

/** One running or paused answer per chat. Another chat can run at the same time. */
export function createRunIfIdle(sessionId: string, username: string): string | null {
  const db = database()
  let id: string | null = null
  db.transaction(() => {
    const active = db
      .prepare(
        "SELECT id FROM luxai_runs WHERE session_id = ? AND username = ? AND status IN ('running', 'paused') LIMIT 1",
      )
      .get(sessionId, username) as { id: string } | undefined
    if (active) return
    id = randomUUID()
    const now = Date.now()
    db.prepare(
      "INSERT INTO luxai_runs (id, session_id, username, status, steer, answer, choice, created_at, updated_at) VALUES (?, ?, ?, 'running', '', '', '', ?, ?)",
    ).run(id, sessionId, username, now, now)
  })()
  return id
}

export interface LuxaiActiveRun {
  id: string
  status: "running" | "paused"
  choice: LuxaiChoice | null
}

function parseChoice(raw: string | null): LuxaiChoice | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as LuxaiChoice
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string" || !Array.isArray(parsed.options)) return null
    return parsed
  } catch {
    return null
  }
}

export function activeRun(username: string, sessionId: string): LuxaiActiveRun | null {
  const row = database()
    .prepare(
      `SELECT id, status, choice FROM luxai_runs
       WHERE session_id = ? AND username = ? AND status IN ('running', 'paused')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(sessionId, username) as { id: string; status: "running" | "paused"; choice: string | null } | undefined
  if (!row) return null
  return { id: row.id, status: row.status, choice: parseChoice(row.choice) }
}

export function runFormSource(username: string, id: string): { sessionId: string; choice: LuxaiChoice | null } | null {
  const row = database()
    .prepare("SELECT session_id AS sessionId, choice FROM luxai_runs WHERE id = ? AND username = ?")
    .get(id, username) as { sessionId: string; choice: string | null } | undefined
  if (!row) return null
  return { sessionId: row.sessionId, choice: parseChoice(row.choice) }
}

export function readRun(username: string, id: string): LuxaiRunControl | null {
  const row = database()
    .prepare("SELECT id, status, steer FROM luxai_runs WHERE id = ? AND username = ?")
    .get(id, username) as { id: string; status: LuxaiRunControl["status"]; steer: string | null } | undefined
  if (!row) return null
  return { id: row.id, status: row.status, steer: row.steer || "" }
}

export function setRunStatus(username: string, id: string, status: LuxaiRunControl["status"]): boolean {
  const result = database()
    .prepare("UPDATE luxai_runs SET status = ?, updated_at = ? WHERE id = ? AND username = ?")
    .run(status, Date.now(), id, username)
  return result.changes === 1
}

export function setRunSteer(username: string, id: string, text: string): boolean {
  const result = database()
    .prepare(
      "UPDATE luxai_runs SET steer = ?, updated_at = ? WHERE id = ? AND username = ? AND status IN ('running', 'paused')",
    )
    .run(text, Date.now(), id, username)
  return result.changes === 1
}

export function takeRunSteer(username: string, id: string): string {
  const row = readRun(username, id)
  if (!row?.steer) return ""
  database()
    .prepare("UPDATE luxai_runs SET steer = '', updated_at = ? WHERE id = ? AND username = ?")
    .run(Date.now(), id, username)
  return row.steer
}

export function setRunChoice(username: string, id: string, choice: LuxaiChoice | null): void {
  database()
    .prepare("UPDATE luxai_runs SET choice = ?, updated_at = ? WHERE id = ? AND username = ?")
    .run(choice ? JSON.stringify(choice) : "", Date.now(), id, username)
}

export function setRunAnswer(username: string, id: string, payload: string): boolean {
  const result = database()
    .prepare(
      "UPDATE luxai_runs SET answer = ?, updated_at = ? WHERE id = ? AND username = ? AND status IN ('running', 'paused')",
    )
    .run(payload, Date.now(), id, username)
  return result.changes === 1
}

export function takeRunAnswer(username: string, id: string): { choiceId: string; selected: string[]; values: Record<string, string> } | null {
  const row = database()
    .prepare("SELECT answer FROM luxai_runs WHERE id = ? AND username = ?")
    .get(id, username) as { answer: string | null } | undefined
  if (!row?.answer) return null
  database()
    .prepare("UPDATE luxai_runs SET answer = '', choice = '', updated_at = ? WHERE id = ? AND username = ?")
    .run(Date.now(), id, username)
  try {
    const parsed = JSON.parse(row.answer) as { choiceId?: string; selected?: unknown; values?: unknown }
    const selected = Array.isArray(parsed.selected)
      ? parsed.selected.filter((item): item is string => typeof item === "string").slice(0, 32)
      : []
    const values: Record<string, string> = {}
    if (parsed.values && typeof parsed.values === "object" && !Array.isArray(parsed.values)) {
      for (const [key, value] of Object.entries(parsed.values).slice(0, 32)) {
        if (typeof value === "string" && key.length <= 64 && value.length <= 12_000) values[key] = value
      }
    }
    if (!parsed.choiceId) return null
    return { choiceId: parsed.choiceId, selected, values }
  } catch {
    return null
  }
}

export interface NewChange {
  sessionId: string
  username: string
  rangeId: string
  kind: LuxaiChangeKind
  summary: string
  preview: string
  beforeText: string
  afterText: string
  revertable: boolean
}

export interface StoredChange extends LuxaiChangeView {
  username: string
  beforeText: string
  afterText: string
}

function proposalYaml(kind: string, afterText: string): string | undefined {
  if (kind === "range_config" && afterText.trim()) return afterText
  if (kind !== "range_create") return undefined
  try {
    const spec = JSON.parse(afterText) as { yaml?: unknown }
    return typeof spec.yaml === "string" && spec.yaml.trim() ? spec.yaml : undefined
  } catch {
    return undefined
  }
}

function changeView(row: StoredChange): LuxaiChangeView {
  return {
    id: row.id,
    sessionId: row.sessionId,
    rangeId: row.rangeId,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    preview: row.preview,
    yaml: proposalYaml(row.kind, row.afterText),
    revertable: row.revertable,
    createdAt: row.createdAt,
  }
}

export function insertChange(input: NewChange): LuxaiChangeView {
  const id = randomUUID()
  const createdAt = Date.now()
  database()
    .prepare(
      `INSERT INTO luxai_changes (
        id, session_id, username, range_id, kind, status, summary, preview, before_text, after_text, revertable, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.sessionId,
      input.username,
      input.rangeId,
      input.kind,
      input.summary,
      input.preview,
      input.beforeText,
      input.afterText,
      input.revertable ? 1 : 0,
      createdAt,
    )
  return {
    id,
    sessionId: input.sessionId,
    rangeId: input.rangeId,
    kind: input.kind,
    status: "pending",
    summary: input.summary,
    preview: input.preview,
    yaml: proposalYaml(input.kind, input.afterText),
    revertable: input.revertable,
    createdAt,
  }
}

export function setChangeAfterText(username: string, id: string, afterText: string): void {
  database()
    .prepare("UPDATE luxai_changes SET after_text = ? WHERE id = ? AND username = ?")
    .run(afterText, id, username)
}

function readChange(id: string): StoredChange | null {
  const row = database()
    .prepare(
      `SELECT id, session_id AS sessionId, username, range_id AS rangeId, kind, status, summary, preview,
              before_text AS beforeText, after_text AS afterText, revertable, created_at AS createdAt
       FROM luxai_changes WHERE id = ?`,
    )
    .get(id) as (Omit<StoredChange, "revertable"> & { revertable: number }) | undefined
  if (!row) return null
  return { ...row, revertable: row.revertable === 1, kind: row.kind as LuxaiChangeKind, status: row.status as LuxaiChangeStatus }
}

export function getChangeForUser(username: string, id: string): StoredChange | null {
  const row = readChange(id)
  if (!row || row.username !== username) return null
  return row
}

export function listChanges(username: string, sessionId: string): LuxaiChangeView[] {
  const rows = database()
    .prepare(
      `SELECT id, session_id AS sessionId, username, range_id AS rangeId, kind, status, summary, preview,
              before_text AS beforeText, after_text AS afterText, revertable, created_at AS createdAt
       FROM luxai_changes WHERE session_id = ? AND username = ? ORDER BY created_at ASC`,
    )
    .all(sessionId, username) as Array<Omit<StoredChange, "revertable"> & { revertable: number }>
  return rows.map((row) =>
    changeView({
      ...row,
      revertable: row.revertable === 1,
      kind: row.kind as LuxaiChangeKind,
      status: row.status as LuxaiChangeStatus,
    }),
  )
}

export function claimPending(id: string, username: string): boolean {
  const result = database()
    .prepare("UPDATE luxai_changes SET status = 'applying' WHERE id = ? AND username = ? AND status = 'pending'")
    .run(id, username)
  return result.changes === 1
}

export function settleClaim(id: string, username: string, status: "applied" | "pending"): void {
  database()
    .prepare(
      "UPDATE luxai_changes SET status = ?, applied_at = ? WHERE id = ? AND username = ? AND status = 'applying'",
    )
    .run(status, status === "applied" ? Date.now() : null, id, username)
}

export function noteAppliedOutput(id: string, username: string, output: string): void {
  const row = database()
    .prepare("SELECT preview FROM luxai_changes WHERE id = ? AND username = ?")
    .get(id, username) as { preview: string } | undefined
  if (!row) return
  const preview = `${row.preview}\n\n--- output ---\n${output}`.slice(0, LUXAI_LIMITS.outputMax)
  database().prepare("UPDATE luxai_changes SET preview = ? WHERE id = ? AND username = ?").run(preview, id, username)
}

export function markChange(id: string, username: string, status: "rejected" | "reverted"): boolean {
  const column = status === "reverted" ? "reverted_at" : "applied_at"
  const from = status === "reverted" ? "applied" : "pending"
  const result = database()
    .prepare(
      `UPDATE luxai_changes SET status = ?, ${column} = ? WHERE id = ? AND username = ? AND status = ?`,
    )
    .run(status, Date.now(), id, username, from)
  return result.changes === 1
}
