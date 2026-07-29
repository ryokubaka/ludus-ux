import { describe, expect, it } from "vitest"
import { formatToolChatDetail, prettyToolChatDetail, redactSecrets } from "./redact-secrets"

describe("redactSecrets", () => {
  it("redacts confirmToken and apiKey keys", () => {
    const out = redactSecrets({
      needsConfirmation: true,
      confirmToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
      apiKey: "super-secret-key-value",
      ok: true,
    }) as Record<string, unknown>
    expect(out.confirmToken).toBe("[redacted]")
    expect(out.apiKey).toBe("[redacted]")
    expect(out.ok).toBe(true)
  })

  it("redacts JWTs inside nested strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE.sig"
    const out = redactSecrets({ data: { output: `token=${jwt} done` } }) as {
      data: { output: string }
    }
    expect(out.data.output).not.toContain(jwt)
    expect(out.data.output).toContain("[redacted]")
  })

  it("redacts Bearer headers", () => {
    const out = redactSecrets("Authorization: Bearer sk-abc1234567890xyz") as string
    expect(out).toMatch(/Bearer \[redacted\]/i)
    expect(out).not.toContain("sk-abc")
  })
})

describe("formatToolChatDetail", () => {
  it("prefixes direction and redacts", () => {
    const s = formatToolChatDetail("←", { confirmToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.a.b" })
    expect(s.startsWith("← ")).toBe(true)
    expect(s).toContain("[redacted]")
    expect(s).not.toContain("eyJ")
  })

  it("truncates long payloads", () => {
    const big = { output: "x".repeat(20_000) }
    const s = formatToolChatDetail("←", big, 500)
    expect(s.length).toBeLessThanOrEqual(510)
    expect(s.endsWith("…")).toBe(true)
  })
})

describe("prettyToolChatDetail", () => {
  it("indents compact JSON blobs", () => {
    const pretty = prettyToolChatDetail('← {"a":1,"b":{"c":2}}')
    expect(pretty).toContain("←\n")
    expect(pretty).toContain('  "a": 1')
    expect(pretty).toContain('  "b": {')
  })

  it("expands multiline log strings instead of escaping \\n", () => {
    const pretty = prettyToolChatDetail(
      '← {"status":200,"data":{"result":"line1\\nline2\\nline3"}}',
    )
    expect(pretty).toContain("line1\n")
    expect(pretty).toContain("line2\n")
    expect(pretty).not.toMatch(/line1\\nline2/)
  })

  it("softens truncated invalid JSON so \\n still breaks lines", () => {
    const pretty = prettyToolChatDetail('← {"data":{"result":"a\\nb\\nc…')
    expect(pretty).toContain("a\nb\nc")
  })
})
