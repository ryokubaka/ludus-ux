/**
 * Mutating browser requests are refused at the proxy, before a route runs.
 * A new route cannot skip this; Next calls src/proxy.ts for the app.
 */
import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { requestOriginAllowed } from "@/lib/core/request-origin"

function post(headers: Record<string, string>) {
  return { method: "POST", headers: new Headers(headers) }
}

describe("origin gate", () => {
  it("the proxy rejects a mutating cross-site request before the session gate", () => {
    expect(existsSync("middleware.ts")).toBe(false)
    expect(existsSync("src/middleware.ts")).toBe(false)
    const proxy = readFileSync("src/proxy.ts", "utf8")
    const originAt = proxy.indexOf("if (!requestOriginAllowed(request))")
    const sessionAt = proxy.indexOf("getSessionFromRequest(request)")
    expect(originAt, "src/proxy.ts must call requestOriginAllowed").toBeGreaterThan(-1)
    expect(sessionAt, "the origin check has to run before the session is read").toBeGreaterThan(originAt)
    expect(proxy).toContain("Cross-origin request blocked")
    expect(proxy).toContain("status: 403")

    expect(requestOriginAllowed(post({ "sec-fetch-site": "cross-site", origin: "https://evil.test" }))).toBe(false)
    expect(requestOriginAllowed(post({ "sec-fetch-site": "same-origin" }))).toBe(true)
    expect(requestOriginAllowed({ method: "GET", headers: new Headers({ "sec-fetch-site": "cross-site" }) })).toBe(true)
  })
})
