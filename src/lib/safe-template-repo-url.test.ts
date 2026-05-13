import { describe, expect, it } from "vitest"
import { assertSafeTemplateRepoUrl } from "./safe-template-repo-url"

describe("assertSafeTemplateRepoUrl", () => {
  it("accepts public gitlab api base", () => {
    const r = assertSafeTemplateRepoUrl("https://gitlab.com/api/v4/projects/foo%2Fbar")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.apiBase).toContain("gitlab.com")
  })

  it("rejects http", () => {
    const r = assertSafeTemplateRepoUrl("http://gitlab.com/api/v4/projects/x")
    expect(r.ok).toBe(false)
  })

  it("rejects private ipv4", () => {
    expect(assertSafeTemplateRepoUrl("https://192.168.1.1/api/v4/projects/x").ok).toBe(false)
    expect(assertSafeTemplateRepoUrl("https://10.0.0.1/foo").ok).toBe(false)
    expect(assertSafeTemplateRepoUrl("https://127.0.0.1/foo").ok).toBe(false)
  })

  it("rejects localhost hostname", () => {
    expect(assertSafeTemplateRepoUrl("https://localhost/api/v4/projects/x").ok).toBe(false)
  })
})
