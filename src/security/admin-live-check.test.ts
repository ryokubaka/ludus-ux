/**
 * An admin branch must use the live Ludus check. The cookie's isAdmin is up to
 * 8 hours old, so a demoted admin keeps any handler that reads it directly.
 * Each exception is written down with its reason. The check is per handler, so
 * a POST that calls requireAdmin does not hide a cookie read in GET.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const API_ROOT = path.join(process.cwd(), "src", "app", "api")

/** Reads of the cookie flag. */
const COOKIE_ADMIN = /\b(session|gate\.session|resolved)\??\.isAdmin\b/
/** Live checks against Ludus. */
const LIVE_ADMIN = /\b(requireAdmin|resolveLudusIsAdmin|liveSessionIsAdmin)\s*\(/

const EXCEPTIONS: Record<string, string> = {
  "auth/login": "Sets the flag from the live Ludus profile.",
  "auth/session": "Re-checks Ludus and re-signs the cookie when the flag changed.",
}

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (name === "route.ts") out.push(full)
  }
  return out
}

function localFunctions(source: string): Map<string, string> {
  const fns = new Map<string, string>()
  const starts = [...source.matchAll(/^(?:async\s+)?function\s+(\w+)\s*[(<]|^const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm)]
  for (let i = 0; i < starts.length; i++) {
    const match = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length
    fns.set(match[1] ?? match[2], source.slice(match.index, end))
  }
  return fns
}

function delegated(code: string, locals: Map<string, string>, seen = new Set<string>()): string {
  let out = code
  for (const [name, body] of locals) {
    const delegates = new RegExp(`\\b${name}\\s*\\(|=\\s*${name}\\s*$`, "m")
    if (seen.has(name) || !delegates.test(code)) continue
    seen.add(name)
    out += `\n${delegated(body, locals, seen)}`
  }
  return out
}

describe("admin branches use a live admin check", () => {
  it("no route trusts the cookie's isAdmin alone", () => {
    const offenders: string[] = []
    for (const file of routeFiles(API_ROOT)) {
      const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
      const route = path.relative(API_ROOT, path.dirname(file)).split(path.sep).join("/")
      if (route in EXCEPTIONS) continue
      const locals = localFunctions(source)
      const exportsRe = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\b|^export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s*=/gm
      const found = [...source.matchAll(exportsRe)]
      found.forEach((match, index) => {
        const end = index + 1 < found.length ? found[index + 1].index : source.length
        const body = source.slice(match.index, end)
        const code = delegated(body, locals)
        if (COOKIE_ADMIN.test(code) && !LIVE_ADMIN.test(code)) {
          offenders.push(`${route} ${match[1] ?? match[2]}`)
        }
      })
    }
    expect(offenders.sort()).toEqual([])
  })
})
