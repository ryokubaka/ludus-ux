/**
 * A [Security] changelog bullet in this change has to land with a regression
 * test. On a developer machine, and on a push to the default branch, there is
 * no pull-request diff, so the check passes.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" })
}

describe("security findings in this change", () => {
  it("a security changelog entry in this change has a regression test", () => {
    const base = process.env.LUX_CI_DIFF_BASE ?? ""
    if (!/^[0-9a-f]{7,40}$/i.test(base)) return

    const diff = git(["diff", "-U0", `${base}...HEAD`, "--", "CHANGELOG.md"])
    const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    const security = added.filter((line) => /^\+\s*- \[Security\] /.test(line))
    if (security.length === 0) return

    const names = new Set(
      git(["diff", "--name-only", `${base}...HEAD`])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    )
    const catalog = readFileSync("src/security/regressions.test.ts", "utf8")
    const named = [...catalog.matchAll(/"((?:src|e2e)\/[^"]+\.test\.ts)"/g)].map((match) => match[1])
    const covered = names.has("src/security/regressions.test.ts") || named.some((file) => names.has(file))
    expect(covered, "add the test to src/security/regressions.test.ts, or update a focused test that file already names").toBe(true)
  })
})
