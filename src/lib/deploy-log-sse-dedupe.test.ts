import { describe, expect, it } from "vitest"
import { normalizeDeployLogDedupeKey, createDeployLogDedupe } from "./deploy-log-sse-dedupe"

describe("normalizeDeployLogDedupeKey", () => {
  it("strips trailing CR", () => {
    expect(normalizeDeployLogDedupeKey("hello\r")).toBe("hello")
  })

  it("trims trailing whitespace", () => {
    expect(normalizeDeployLogDedupeKey("hello   ")).toBe("hello")
  })

  it("preserves leading whitespace", () => {
    expect(normalizeDeployLogDedupeKey("  hello")).toBe("  hello")
  })

  it("returns empty string for blank input", () => {
    expect(normalizeDeployLogDedupeKey("")).toBe("")
  })
})

describe("createDeployLogDedupe", () => {
  it("detects duplicates after remember", () => {
    const dedupe = createDeployLogDedupe()
    dedupe.remember("line1")
    expect(dedupe.isDuplicate("line1")).toBe(true)
  })

  it("does not flag unknown lines as duplicates", () => {
    const dedupe = createDeployLogDedupe()
    expect(dedupe.isDuplicate("never-seen")).toBe(false)
  })

  it("normalizes before comparing", () => {
    const dedupe = createDeployLogDedupe()
    dedupe.remember("line1\r")
    expect(dedupe.isDuplicate("line1")).toBe(true)
  })

  it("does not treat empty lines as duplicates", () => {
    const dedupe = createDeployLogDedupe()
    dedupe.remember("")
    expect(dedupe.isDuplicate("")).toBe(false)
  })
})
