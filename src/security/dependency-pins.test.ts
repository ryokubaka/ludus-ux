import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const picomatch = createRequire(import.meta.url)("../../vendor/picomatch") as {
  isMatch: (input: string, pattern: string) => boolean
  makeRe: (pattern: string) => RegExp
}

function atLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map(Number)
  const right = minimum.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const a = left[i] ?? 0
    const b = right[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

describe("November 2026 dependency advisories", () => {
  it("pins Next.js at 16.4.5 or newer and ws at 8.23.0 or newer", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { version?: string }>
    }
    expect(atLeast(lock.packages["node_modules/next"]?.version ?? "0", "16.4.5")).toBe(true)
    expect(atLeast(lock.packages["node_modules/ws"]?.version ?? "0", "8.23.0")).toBe(true)
    expect(atLeast(lock.packages["node_modules/eslint-config-next"]?.version ?? "0", "16.4.5")).toBe(true)
  })

  it("uses the vendored picomatch that compiles a repeated star extglob once", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { version?: string; resolved?: string }>
    }
    const copies = Object.entries(lock.packages).filter(
      ([name]) => name === "vendor/picomatch" || name.endsWith("/picomatch"),
    )
    expect(copies.map(([name]) => name)).toContain("vendor/picomatch")
    for (const [name, pkg] of copies) {
      if (name === "vendor/picomatch") expect(pkg.version).toBe("4.0.8")
      else expect(pkg.resolved).toBe("vendor/picomatch")
    }
    expect(picomatch.makeRe("+(*a)").source).not.toMatch(/\)\+/)
    const started = Date.now()
    expect(picomatch.isMatch(`${"a".repeat(64)}b`, "+(*a)")).toBe(false)
    expect(Date.now() - started).toBeLessThan(100)
    expect(picomatch.isMatch("aaa", "+(*a)")).toBe(true)
  })

  it("removes picomatch backslashes in one pass", () => {
    const utils = createRequire(import.meta.url)("../../vendor/picomatch/lib/utils.js") as {
      removeBackslashes: (value: string) => string
    }
    expect(utils.removeBackslashes("a\\b[c\\]d]e\\f")).toBe("ab[c\\]d]ef")
    expect(utils.removeBackslashes("\\[a]")).toBe("[a]")
    const attack = "[".repeat(20_000)
    const started = Date.now()
    expect(utils.removeBackslashes(attack)).toBe(attack)
    expect(Date.now() - started).toBeLessThan(100)
  })
})
