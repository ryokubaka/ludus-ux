/**
 * Ids from the URL or the body stay out of a filesystem path until something
 * has made them one segment. A sanitizer call on that binding counts: the
 * route audit uses the same file-level rule for owner checks.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const API_ROOT = path.join(process.cwd(), "src", "app", "api")

const SANITIZER = "assertSafeInstanceId|sanitizeUsername|safeFilename|sanitizeFilename|encodeURIComponent|path\\.basename|basename"

function stripLineComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, "")
}

/** Bindings that still carry a request value. */
export function unsafePathNames(source: string): Set<string> {
  const code = stripLineComments(source)
  const tainted = new Set<string>()
  for (const match of code.matchAll(/const\s*\{([^}]+)\}\s*=\s*await\s+[^;\n]*\bparams\b/g)) {
    for (const part of match[1].split(",")) {
      const bits = part.split(":").map((piece) => piece.trim())
      const binding = bits.length > 1 ? bits[1] : bits[0]
      if (/^[A-Za-z_]\w*$/.test(binding)) tainted.add(binding)
    }
  }
  for (const match of code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*[^;\n]*\bsearchParams\.get\s*\(/g)) {
    tainted.add(match[1])
  }
  for (const match of code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+[^;\n]*\b(?:json|formData)\s*\(/g)) {
    tainted.add(match[1])
  }

  let grew = true
  while (grew) {
    grew = false
    for (const match of code.matchAll(/(?:const|let)?\s*(\w+)\s*=\s*(?:decodeURIComponent|String)\(\s*(\w+)\s*\)/g)) {
      if (match[1] === "const" || match[1] === "let") continue
      if (tainted.has(match[2]) && !tainted.has(match[1])) {
        tainted.add(match[1])
        grew = true
      }
    }
  }

  const safe = new Set<string>()
  const assign = new RegExp(`(?:const|let)?\\s*(\\w+)\\s*=\\s*(?:${SANITIZER})\\s*\\(`, "g")
  for (const match of code.matchAll(assign)) {
    if (match[1] !== "const" && match[1] !== "let") safe.add(match[1])
  }
  for (const match of code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\w+\.replace\(\s*\/\[\^a-zA-Z0-9_-\]\/g\s*,\s*["']["']\s*\)/g)) {
    safe.add(match[1])
  }
  const call = new RegExp(`\\b(?:assertSafeInstanceId|sanitizeUsername|safeFilename|sanitizeFilename)\\s*\\(\\s*(\\w+)\\s*\\)`, "g")
  for (const match of code.matchAll(call)) safe.add(match[1])
  for (const match of code.matchAll(/\/\^\[A-Za-z0-9_-\]\+\$\/\.test\(\s*(\w+)\s*\)/g)) safe.add(match[1])
  for (const match of code.matchAll(/\bINSTANCE_ID_PATTERN\.test\(\s*(\w+)\s*\)/g)) safe.add(match[1])
  for (const match of code.matchAll(/\bisNaN\(\s*Number\(\s*(\w+)\s*\)\s*\)/g)) safe.add(match[1])
  for (const name of tainted) {
    if (new RegExp(`\\b${name}\\s*(?:===|!==)\\s*["']`).test(code)) safe.add(name)
  }

  const unsafe = new Set<string>()
  for (const name of tainted) if (!safe.has(name)) unsafe.add(name)
  return unsafe
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

/** Argument text of calls named in `pattern`, each with its opening paren index. */
function callArgs(source: string, pattern: RegExp): string[] {
  const args: string[] = []
  for (const match of source.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length
    let depth = 1
    let i = start
    for (; i < source.length && depth > 0; i++) {
      const ch = source[i]
      if (ch === "(") depth++
      else if (ch === ")") depth--
    }
    args.push(source.slice(start, i - 1))
  }
  return args
}

/** A direct use: the binding itself, or `${binding}`, not a call that wraps it. */
function exposed(text: string, unsafe: Set<string>): string[] {
  const found: string[] = []
  for (const name of unsafe) {
    if (new RegExp(`\\$\\{\\s*${name}\\b`).test(text)) found.push(name)
    const pieces = text.split(",").map((piece) => piece.trim())
    if (pieces.some((piece) => piece === name)) found.push(name)
    const member = new RegExp(`\\b${name}\\.[A-Za-z_]\\w*`, "g")
    const wrapped = text.replace(
      new RegExp(
        `(?:assertSafeInstanceId|sanitizeUsername|safeFilename|sanitizeFilename|encodeURIComponent|path\\.basename|basename)\\s*\\(\\s*${name}\\.[A-Za-z_]\\w*\\s*\\)`,
        "g",
      ),
      "",
    )
    if (member.test(wrapped)) found.push(`${name}.*`)
  }
  return [...new Set(found)]
}

export function pathFindings(source: string, file = "route.ts"): string[] {
  const code = stripLineComments(source).replace(/\r\n/g, "\n")
  const unsafe = unsafePathNames(code)
  if (unsafe.size === 0) return []
  const findings: string[] = []
  const contexts = [
    ...callArgs(code, /\bpath\.(?:join|resolve)\s*\(/g),
    ...callArgs(code, /\bfs\.(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rm|rmSync|mkdir|mkdirSync|readdir|readdirSync|createReadStream|createWriteStream|stat|statSync|existsSync|rename|renameSync|copyFile|copyFileSync)\s*\(/g),
  ]
  for (const arg of contexts) {
    for (const name of exposed(arg, unsafe)) findings.push(`${file}: ${name} reaches a filesystem path`)
  }
  for (const match of code.matchAll(/`([^`\\]|\\.)*`/g)) {
    const text = match[0]
    // Log lines interpolate ids next to words. A path template has no spaces.
    if (!text.includes("/") || /\s/.test(text) || /https?:\/\//.test(text)) continue
    for (const name of exposed(text, unsafe)) findings.push(`${file}: ${name} reaches a filesystem path`)
  }
  if (code.includes("os.path.join")) {
    for (const match of code.matchAll(/\bb64\(\s*(\w+)\s*\)/g)) {
      if (unsafe.has(match[1])) findings.push(`${file}: ${match[1]} reaches a filesystem path`)
    }
  }
  return [...new Set(findings)]
}

describe("request ids in filesystem paths", () => {
  it("keeps request ids out of filesystem paths until they are one segment", () => {
    const findings = routeFiles(API_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return pathFindings(source, path.relative(process.cwd(), file).split(path.sep).join("/"))
    })
    expect(findings, "validate the id as one path segment before it reaches a path").toEqual([])
  })

  it("rejects a route param joined onto a path", () => {
    const sample = `
      export async function GET(_request: Request, ctx: { params: Promise<{ instanceId: string }> }) {
        const { instanceId } = await ctx.params
        return fs.readFileSync(path.join(DIR, instanceId))
      }
    `
    expect(pathFindings(sample).length).toBeGreaterThan(0)
  })

  it("accepts assertSafeInstanceId before the path", () => {
    const sample = `
      export async function GET(_request: Request, ctx: { params: Promise<{ instanceId: string }> }) {
        const { instanceId } = await ctx.params
        const safe = assertSafeInstanceId(instanceId)
        return fs.readFileSync(path.join(DIR, safe))
      }
    `
    expect(pathFindings(sample)).toEqual([])
  })

  it("rejects a decoded param that a remote script joins onto a path", () => {
    const sample = `
      const { instanceId: rawId } = await params
      let instanceId: string
      instanceId = decodeURIComponent(rawId)
      const cmd = b64(instanceId)
      const py = "os.path.join(workspace, instance_id)"
    `
    expect(pathFindings(sample).length).toBeGreaterThan(0)
  })

  it("accepts assertSafeInstanceId on that assignment", () => {
    const sample = `
      const { instanceId: rawId } = await params
      let instanceId: string
      instanceId = assertSafeInstanceId(decodeURIComponent(rawId))
      const cmd = b64(instanceId)
      const py = "os.path.join(workspace, instance_id)"
    `
    expect(pathFindings(sample)).toEqual([])
  })
})
