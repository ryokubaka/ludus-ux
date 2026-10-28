import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test"
import { requireAdminCredentials } from "../helpers/auth"

/** The throwaway non-admin user the suite creates and deletes. */
export type SecurityState = {
  userId: string
  password: string
  apiKey: string
  /** Synthetic GOAD instance ids the suite stored snapshots under. */
  syntheticIds: string[]
}

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://localhost"

/** Lives outside the repo (it holds the throwaway password and key) and is deleted by teardown. */
export const STATE_FILE = path.join(
  os.tmpdir(),
  `lux-security-gate-${Buffer.from(BASE_URL).toString("hex").slice(0, 24)}.json`,
)

export function readState(): SecurityState {
  if (!existsSync(STATE_FILE)) throw new Error(`Security setup did not run (no ${STATE_FILE})`)
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as SecurityState
}

export function writeState(state: SecurityState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 })
}

export function removeState(): void {
  rmSync(STATE_FILE, { force: true })
}

export function randomId(prefix: string, bytes = 3): string {
  return `${prefix}${randomBytes(bytes).toString("hex")}`
}

export function randomPassword(): string {
  return `${randomBytes(12).toString("base64url")}!a9`
}

export async function newContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
}

/** Logs in through /api/auth/login, answering the API key step when Ludus asks for it. */
export async function login(username: string, password: string, apiKey?: string): Promise<APIRequestContext> {
  const ctx = await newContext()
  const res = await ctx.post("/api/auth/login", { data: { username, password } })
  const body = (await res.json().catch(() => ({}))) as { needsApiKey?: boolean; continuationToken?: string; error?: string }
  if (res.ok() && !body.needsApiKey) return ctx
  if (body.needsApiKey && body.continuationToken && apiKey) {
    const second = await ctx.post("/api/auth/login", { data: { continuationToken: body.continuationToken, apiKey } })
    if (second.ok()) return ctx
    throw new Error(`Login as ${username} failed at the API key step: HTTP ${second.status()}`)
  }
  throw new Error(`Login as ${username} failed: HTTP ${res.status()} ${body.error ?? ""}`.trim())
}

export async function loginAdmin(): Promise<APIRequestContext> {
  const { username, password } = requireAdminCredentials()
  return login(username, password, process.env.E2E_LUDUS_API_KEY || undefined)
}

export async function loginThrowaway(): Promise<APIRequestContext> {
  const state = readState()
  return login(state.userId, state.password, state.apiKey)
}

const ADMIN_PROXY = { "X-Ludus-Admin": "true" }
export const adminProxyHeaders = ADMIN_PROXY

/** Expects a refusal. A 2xx means the check let the request through. */
export function expectDenied(status: number, what: string, allowed: number[] = [401, 403]) {
  expect(allowed, `${what} returned ${status}`).toContain(status)
}

// --- Route inventory (same source the offline route audit reads) ------------

export type RouteHandler = { url: string; method: string; route: string }

/** Handlers anyone may call, mirroring PUBLIC_HANDLERS in src/security/route-audit.test.ts. */
export const PUBLIC_HANDLERS = new Set([
  "auth/login POST",
  "auth/logout POST",
  "auth/revoke GET",
  "health GET",
  "logo GET",
  "logo HEAD",
  "about GET",
  "changelog GET",
])

/** Values for dynamic segments. None of them name a real object. */
const SEGMENT_VALUES: Record<string, string> = {
  instanceId: "luxsecnoinstance",
  taskId: "luxsecnotask",
  "...path": "version",
}

function segmentValue(segment: string): string {
  const name = segment.replace(/^\[\[?|\]?\]$/g, "")
  return SEGMENT_VALUES[name] ?? `luxsec${name.replace(/\W/g, "").toLowerCase()}`
}

export function apiHandlers(): RouteHandler[] {
  const root = path.join(process.cwd(), "src", "app", "api")
  const out: RouteHandler[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name === "route.ts") {
        const route = path.relative(root, dir).split(path.sep).join("/")
        const source = readFileSync(full, "utf8")
        const methods = new Set(
          [...source.matchAll(/^export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\b/gm)].map((m) => m[1]),
        )
        const url = `/api/${route.split("/").map((s) => (s.startsWith("[") ? segmentValue(s) : s)).join("/")}`
        for (const method of methods) out.push({ url, method, route })
      }
    }
  }
  walk(root)
  return out
}
