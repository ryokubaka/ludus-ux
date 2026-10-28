/**
 * Structural checks over every API route. The advisory and its follow-up were
 * all one of these mistakes: a handler with no session gate, a write path with
 * no owner check, or a GET that changes state. A new route that repeats one of
 * them fails here, and an exception has to be written down with a reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const API_ROOT = path.join(process.cwd(), "src", "app", "api")

/** Calls that resolve the server-side session (cookie plus credential vault). */
const GATE_CALL = /\b(requireSession|requireAdmin|resolveSession|requireSourcesSession|resolveLudushoundSession)\s*\(/
/** A path that refuses the caller: 401/403, or the gate helper's prepared response. */
const DENY_EXIT = /status:\s*40[13]\b|\b\w+\.response\b/

/** Routes reachable without a session, each with the reason. */
const PUBLIC_HANDLERS: Record<string, string> = {
  "auth/login POST": "The login itself.",
  "auth/logout POST": "Clears only the caller's own cookie and vault row; needs no live session.",
  "auth/revoke GET": "Clears only a cookie whose vault row is already gone (see auth/revoke route test).",
  "health GET": "Container health check; returns no data.",
  "logo GET": "Branding image shown on the login page.",
  "logo HEAD": "Branding image shown on the login page.",
  "about GET": "Version and license text. src/proxy.ts still requires a session cookie.",
  "changelog GET": "Release notes. src/proxy.ts still requires a session cookie.",
}

/** Owner checks a route acting on a GOAD instance or task must make. */
const OWNER_CHECK = /\b(assertGoadInstanceAccess|assertGoadTaskAccess|canAccessGoadTask|requireAdmin)\b/

/** Routes that name an instance or task but need no owner check, with the reason. */
const OWNER_EXCEPTIONS: Record<string, string> = {
  "goad/by-range": "Returns the instance id linked to a range; every action on that id checks ownership.",
}

/** State changes that must not happen in a GET (a link from another site can trigger it). */
const GET_SIDE_EFFECT =
  /\b(writeFileSync|writeFile|unlinkSync|rmSync|mkdirSync|clearSession\w*|readUnlink\w*|write[A-Z]\w*Snapshot|set[A-Z]\w*Local|setOwnership|createDeployHandoff|linkHandoffToTask|forgetSshHostKey)\s*\(|\.prepare\([^)]*\b(INSERT|UPDATE|DELETE)\b|method:\s*"(POST|PUT|PATCH|DELETE)"/

/** GET handlers that write, each with the reason it is safe. */
const GET_SIDE_EFFECT_EXCEPTIONS: Record<string, string> = {
  "auth/revoke GET": "Clears only a cookie whose credential row is already gone.",
  "auth/session GET": "Re-signs the caller's own cookie when Ludus reports a different admin flag.",
}

type Handler = { route: string; method: string; body: string; file: string; source: string }

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (name === "route.ts") out.push(full)
  }
  return out
}

/** Bodies of the non-exported functions a handler may delegate to. */
function localFunctions(source: string): Map<string, string> {
  const fns = new Map<string, string>()
  const starts = [...source.matchAll(/^(?:async\s+)?function\s+(\w+)\s*[(<]|^const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm)]
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length
    fns.set(m[1] ?? m[2], source.slice(m.index, end))
  }
  return fns
}

function handlers(): Handler[] {
  const out: Handler[] = []
  for (const file of routeFiles(API_ROOT)) {
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
    const route = path.relative(API_ROOT, path.dirname(file)).split(path.sep).join("/")
    const exportsRe = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\b|^export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s*=/gm
    const found = [...source.matchAll(exportsRe)]
    found.forEach((m, i) => {
      const end = i + 1 < found.length ? found[i + 1].index : source.length
      out.push({ route, method: m[1] ?? m[2], body: source.slice(m.index, end), file, source })
    })
  }
  return out
}

function isGated(code: string, locals: Map<string, string>, seen = new Set<string>()): boolean {
  if (GATE_CALL.test(code) && DENY_EXIT.test(code)) return true
  for (const [name, body] of locals) {
    // A call `name(...)`, or an alias `export const GET = name`.
    const delegates = new RegExp(`\\b${name}\\s*\\(|=\\s*${name}\\s*$`, "m")
    if (seen.has(name) || !delegates.test(code)) continue
    seen.add(name)
    if (isGated(body, locals, seen)) return true
  }
  return false
}

/** Same length as the input, with strings and comments blanked, so braces and `return` count only in code. */
function codeOnly(code: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return code
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/.*$/gm, blank)
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, blank)
    .replace(/"(?:\\.|[^"\\\n])*"/g, blank)
    .replace(/'(?:\\.|[^'\\\n])*'/g, blank)
}

/** Index just inside the function body's opening brace. */
function bodyStart(code: string): number {
  const open = code.indexOf("(")
  if (open < 0) return -1
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++
    else if (code[i] === ")" && --depth === 0) {
      const brace = code.indexOf("{", i)
      return brace < 0 ? -1 : brace + 1
    }
  }
  return -1
}

/**
 * The gate must run before anything else can answer: not inside an `if`,
 * loop, or switch (a top-level `try` is fine), and no `return` before it.
 * Returns why it fails, or null.
 */
function gateProblem(raw: string): string | null {
  const code = codeOnly(raw)
  const start = bodyStart(code)
  const gate = code.search(GATE_CALL)
  if (start < 0 || gate < 0) return "no gate"
  const before = code.slice(start, gate)
  if (/\breturn\b/.test(before)) return "returns before the gate"
  const open: string[] = []
  for (let i = 0; i < before.length; i++) {
    if (before[i] === "{") open.push(before.slice(Math.max(0, i - 12), i))
    else if (before[i] === "}") open.pop()
  }
  if (open.some((prefix) => !/\btry\s*$/.test(prefix))) return "gate is inside a conditional block"
  return null
}

/** The code that holds the gate: the handler itself, or the local function it delegates to. */
function gateHolder(code: string, locals: Map<string, string>, seen = new Set<string>()): string | null {
  if (GATE_CALL.test(code)) return code
  for (const [name, body] of locals) {
    const delegates = new RegExp(`\\b${name}\\s*\\(|=\\s*${name}\\s*$`, "m")
    if (seen.has(name) || !delegates.test(code)) continue
    seen.add(name)
    const found = gateHolder(body, locals, seen)
    if (found) return found
  }
  return null
}

const all = handlers()

describe("API route audit", () => {
  it("finds the route handlers", () => {
    expect(all.length).toBeGreaterThan(100)
  })

  it("gates every handler on the server session, or lists why it is public", () => {
    const ungated = all
      .filter((h) => !PUBLIC_HANDLERS[`${h.route} ${h.method}`])
      .filter((h) => !isGated(h.body, localFunctions(h.source)))
      .map((h) => `${h.route} ${h.method}`)
    expect(ungated, "add a requireSession/requireAdmin gate that returns 401/403").toEqual([])
  })

  it("runs the gate first, on every path through the handler", () => {
    const late = all
      .filter((h) => !PUBLIC_HANDLERS[`${h.route} ${h.method}`])
      .map((h) => {
        const holder = gateHolder(h.body, localFunctions(h.source))
        const problem = holder ? gateProblem(holder) : "no gate"
        return problem ? `${h.route} ${h.method}: ${problem}` : null
      })
      .filter(Boolean)
    expect(late, "move the session gate to the top of the handler").toEqual([])
  })

  it("keeps the public list current", () => {
    const present = new Set(all.map((h) => `${h.route} ${h.method}`))
    expect(Object.keys(PUBLIC_HANDLERS).filter((key) => !present.has(key))).toEqual([])
  })

  it("checks ownership in every route that acts on a GOAD instance or task", () => {
    const files = new Map(all.map((h) => [h.route, h.source]))
    const missing: string[] = []
    for (const [route, source] of files) {
      const scoped = /\[(instanceId|taskId)\]/.test(route)
      const takesId = route.startsWith("goad/") && /\b(instanceId|instanceIds|taskId)\b/.test(source)
      if (!scoped && !takesId) continue
      if (OWNER_EXCEPTIONS[route]) continue
      if (!OWNER_CHECK.test(source)) missing.push(route)
    }
    expect(missing, "call assertGoadInstanceAccess or assertGoadTaskAccess, or add an exception with a reason").toEqual([])
  })

  it("never treats a username prefix in an instance id as ownership", () => {
    const prefixChecks = all
      .filter((h) => /startsWith\(\s*\w+\.toLowerCase\(\)\s*\+\s*"-"\s*\)/.test(h.source))
      .map((h) => h.route)
    expect([...new Set(prefixChecks)]).toEqual([])
  })

  it("changes no state in a GET handler", () => {
    const offenders = all
      .filter((h) => h.method === "GET" && !GET_SIDE_EFFECT_EXCEPTIONS[`${h.route} GET`])
      .filter((h) => GET_SIDE_EFFECT.test(h.body))
      .map((h) => h.route)
    expect(offenders, "move the change to POST/PUT/PATCH/DELETE").toEqual([])
  })

  it("keeps the exception lists current", () => {
    const routes = new Set(all.map((h) => h.route))
    const stale = [
      ...Object.keys(OWNER_EXCEPTIONS).filter((route) => !routes.has(route)),
      ...Object.keys(GET_SIDE_EFFECT_EXCEPTIONS).filter((key) => !routes.has(key.replace(/ GET$/, ""))),
    ]
    expect(stale).toEqual([])
  })
})
