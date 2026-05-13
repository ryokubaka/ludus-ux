import { describe, expect, it, afterEach } from "vitest"
import { resolveRootApiKey, isLudusRootApiKeyEnvOverrideActive, normalizeLudusApiKeyInput } from "./resolve-root-api-key"

describe("resolveRootApiKey", () => {
  it("non-empty env beats merged/DB value", () => {
    expect(resolveRootApiKey("env-secret", "db-secret")).toBe("env-secret")
  })

  it("empty env uses merged value (e.g. SQLite)", () => {
    expect(resolveRootApiKey("", "db-only")).toBe("db-only")
    expect(resolveRootApiKey(undefined, "db-only")).toBe("db-only")
  })

  it("both empty → empty string", () => {
    expect(resolveRootApiKey("", "")).toBe("")
    expect(resolveRootApiKey(undefined, undefined)).toBe("")
    expect(resolveRootApiKey("", undefined)).toBe("")
  })

  it("trims whitespace; whitespace-only env falls through to merged", () => {
    expect(resolveRootApiKey("  env  ", "db")).toBe("env")
    expect(resolveRootApiKey("   ", "db")).toBe("db")
    expect(resolveRootApiKey(undefined, "  db  ")).toBe("db")
  })
})

describe("isLudusRootApiKeyEnvOverrideActive", () => {
  afterEach(() => {
    delete process.env.LUDUS_ROOT_API_KEY
  })

  it("false when unset", () => {
    delete process.env.LUDUS_ROOT_API_KEY
    expect(isLudusRootApiKeyEnvOverrideActive()).toBe(false)
  })

  it("false when whitespace-only", () => {
    process.env.LUDUS_ROOT_API_KEY = "   \t"
    expect(isLudusRootApiKeyEnvOverrideActive()).toBe(false)
  })

  it("true when non-empty", () => {
    process.env.LUDUS_ROOT_API_KEY = "ROOT.x"
    expect(isLudusRootApiKeyEnvOverrideActive()).toBe(true)
  })
})

describe("normalizeLudusApiKeyInput", () => {
  it("strips CRLF and BOM", () => {
    expect(normalizeLudusApiKeyInput("ROOT.k\r\n")).toBe("ROOT.k")
    expect(normalizeLudusApiKeyInput("\uFEFFROOT.k")).toBe("ROOT.k")
  })

  it("strips matching quotes", () => {
    expect(normalizeLudusApiKeyInput('"ROOT.secret"')).toBe("ROOT.secret")
    expect(normalizeLudusApiKeyInput("'ROOT.secret'")).toBe("ROOT.secret")
  })

  it("env branch uses normalization in resolveRootApiKey", () => {
    expect(resolveRootApiKey('"quoted"', "db")).toBe("quoted")
  })
})
