import { expect, test } from "@playwright/test"
import { PUBLIC_HANDLERS, apiHandlers, expectDenied, newContext } from "./helpers"

// Every API handler, called with no session. The edge proxy refuses most of
// them; the SSE routes it skips must refuse on their own.
test("every API route refuses a request without a session", async () => {
  test.setTimeout(10 * 60_000)
  const ctx = await newContext()
  const handlers = apiHandlers().filter((h) => !PUBLIC_HANDLERS.has(`${h.route} ${h.method}`))
  expect(handlers.length).toBeGreaterThan(100)

  const accepted: string[] = []
  for (const h of handlers) {
    const res = await ctx.fetch(h.url, {
      method: h.method,
      data: h.method === "GET" || h.method === "HEAD" ? undefined : {},
      maxRedirects: 0,
      timeout: 20_000,
    })
    if (![401, 403].includes(res.status())) accepted.push(`${h.method} ${h.url} → ${res.status()}`)
    await res.dispose()
  }
  await ctx.dispose()
  expect(accepted, "these answered without a session").toEqual([])
})

test("a cross-site POST is refused before it reaches the route", async () => {
  const ctx = await newContext()
  const res = await ctx.post("/api/auth/login", {
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    data: { username: "luxsecnobody", password: "x" },
  })
  expectDenied(res.status(), "cross-site login", [403])
  await ctx.dispose()
})
