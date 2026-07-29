import { describe, expect, it, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import { collectDocPages, searchDocumentation } from "./docs-corpus"

const TEST_DATA = path.join(process.cwd(), "data-test-docs-corpus")

describe("docs-corpus", () => {
  const prev = process.env.DATA_DIR

  beforeEach(() => {
    process.env.DATA_DIR = TEST_DATA
    fs.mkdirSync(path.join(TEST_DATA, "docs-cache", "ludus"), { recursive: true })
    fs.writeFileSync(
      path.join(TEST_DATA, "docs-cache", "ludus", "docs_intro.md"),
      "---\nurl: https://docs.ludus.cloud/docs/intro\n---\n\n# Ludus Introduction\n\nRanges for testing. WireGuard is for VPN access.\n",
      "utf8",
    )
  })

  afterEach(() => {
    if (prev !== undefined) process.env.DATA_DIR = prev
    else delete process.env.DATA_DIR
    fs.rmSync(TEST_DATA, { recursive: true, force: true })
  })

  it("indexes lux docs, skill trees, and ludus cache", () => {
    const pages = collectDocPages()
    expect(pages.some((p) => p.source === "lux")).toBe(true)
    expect(pages.some((p) => p.source === "ludus-cache")).toBe(true)
    expect(pages.some((p) => p.source === "skill" && p.path.includes("skills/ludus-ux"))).toBe(true)
    expect(
      pages.some(
        (p) =>
          p.source === "skill" &&
          /skills\/ludus\/(range-config|ludus-cli|troubleshooting|environment-guide)/.test(
            p.path.replace(/\\/g, "/"),
          ),
      ),
    ).toBe(true)
  })

  it("searches by keyword", () => {
    const hits = searchDocumentation("introduction ranges WireGuard VPN", 8)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => /ludus|intro|wireguard/i.test(h.title) || /docs_intro|intro/i.test(h.path))).toBe(
      true,
    )
  })

  it("ranks GOAD deploy playbook highly for GOAD deploy queries", () => {
    const hits = searchDocumentation("GOAD-Mini deploy LUX dedicated range executeGoad", 8)
    expect(hits.length).toBeGreaterThan(0)
    const paths = hits.map((h) => h.path.replace(/\\/g, "/"))
    expect(paths.some((p) => p.includes("workflows/goad-deploy.md") || p.includes("workflows/INDEX.md"))).toBe(
      true,
    )
  })

  it("prefers ludus-ux over upstream ludus skills for LUX GOAD routing", () => {
    const hits = searchDocumentation("GOAD ask_user lux_goad executeGoad", 10)
    const paths = hits.map((h) => h.path.replace(/\\/g, "/"))
    const uxIdx = paths.findIndex((p) => p.includes("skills/ludus-ux") && p.includes("goad"))
    const upstreamEnv = paths.findIndex((p) => p.includes("skills/ludus/environment-guide"))
    expect(uxIdx).toBeGreaterThanOrEqual(0)
    if (upstreamEnv >= 0) expect(uxIdx).toBeLessThan(upstreamEnv)
  })
})
