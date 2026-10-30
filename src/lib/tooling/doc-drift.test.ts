import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const script = path.join(process.cwd(), "scripts/check-doc-drift.mjs")
const temps: string[] = []

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lux-doc-drift-"))
  temps.push(dir)
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return dir
}

function run(dir: string) {
  const result = spawnSync(process.execPath, [script, "--root", dir], { encoding: "utf8" })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

const base = {
  "package.json": JSON.stringify({ dependencies: { next: "^16.4.2", react: "^19.2.7" } }),
  ".env.example": "APP_SECRET=change-me\n",
  "docs/index.md": "# Docs\n\n| [Architecture](architecture.md) |\n",
  "docs/architecture.md": "# Architecture\n\n| Framework | Next.js 16 (App Router, React 19) |\n",
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("doc drift check", () => {
  it("accepts a tree whose docs match the code", () => {
    const result = run(fixture(base))
    expect(result.status).toBe(0)
    expect(result.output).toContain("Doc drift: ok")
  })

  it("rejects a framework version that disagrees with package.json", () => {
    const dir = fixture({
      ...base,
      "docs/architecture.md": "# Architecture\n\nNext.js 15 with React 18.\n",
    })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.output).toContain("Next.js 15 disagrees")
    expect(result.output).toContain("React 18 disagrees")
  })

  it("ignores plans: old version quotes and no index entry", () => {
    const result = run(
      fixture({
        ...base,
        "docs/plans/next.md": "# Plan\n\nMove from Next.js 15 to Next.js 16.\n",
      }),
    )
    expect(result.status).toBe(0)
  })

  it("rejects an environment variable the app reads but nothing documents", () => {
    const dir = fixture({
      ...base,
      "src/app/route.ts": 'const x = process.env.LUX_UNDOCUMENTED_FLAG ?? ""\n',
    })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.output).toContain("LUX_UNDOCUMENTED_FLAG is not documented")
  })

  it("accepts a documented variable and ignores Node internals", () => {
    const dir = fixture({
      ...base,
      ".env.example": "APP_SECRET=change-me\nLUX_DOCUMENTED_FLAG=\n",
      "src/app/route.ts": 'const a = process.env.LUX_DOCUMENTED_FLAG\nconst b = process.env.NODE_ENV\n',
    })
    expect(run(dir).status).toBe(0)
  })

  it("does not count a plan as documentation for an environment variable", () => {
    const dir = fixture({
      ...base,
      "docs/plans/next.md": "# Plan\n\n`LUX_PLAN_ONLY_FLAG` is coming.\n",
      "src/app/route.ts": 'const a = process.env.LUX_PLAN_ONLY_FLAG\n',
    })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.output).toContain("LUX_PLAN_ONLY_FLAG is not documented")
  })

  it("rejects a docs page that is not in the index", () => {
    const dir = fixture({ ...base, "docs/orphan.md": "# Orphan\n" })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.output).toContain("does not list docs/orphan.md")
  })

  it("rejects an index entry that points at a missing page", () => {
    const dir = fixture({
      ...base,
      "docs/index.md": "# Docs\n\n| [Architecture](architecture.md) |\n| [Gone](gone.md) |\n",
    })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.output).toContain("links to missing docs/gone.md")
  })

  it("rejects a repository path that does not exist", () => {
    const dir = fixture({
      ...base,
      "docs/architecture.md": "# Architecture\n\nSee `src/lib/missing.ts`.\n",
    })
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.output).toContain("path src/lib/missing.ts does not exist")
  })

  it("accepts a path that exists and skips globs", () => {
    const dir = fixture({
      ...base,
      "docs/architecture.md": "# Architecture\n\nSee `src/lib/core/utils.ts` and `src/app/api/**`.\n",
      "src/lib/core/utils.ts": "export const x = 1\n",
    })
    expect(run(dir).status).toBe(0)
  })
})
