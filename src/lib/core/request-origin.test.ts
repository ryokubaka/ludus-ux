import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { requestOriginAllowed } from "@/lib/core/request-origin"

function post(headers: Record<string, string>) {
  return new NextRequest("https://lux.example/api/settings", {
    method: "POST",
    headers,
  })
}

describe("requestOriginAllowed", () => {
  it("allows a same-origin mutation and a non-browser client", () => {
    expect(requestOriginAllowed(post({
      host: "lux.example",
      origin: "https://lux.example",
      "sec-fetch-site": "same-origin",
    }))).toBe(true)
    expect(requestOriginAllowed(post({ host: "lux.example" }))).toBe(true)
  })

  it("rejects another port on the same host", () => {
    expect(requestOriginAllowed(post({
      host: "lux.example",
      origin: "https://lux.example:8006",
      "sec-fetch-site": "same-site",
    }))).toBe(false)
  })

  it("allows a login on an 8443:443 mapping even when the proxy dropped the port", () => {
    expect(requestOriginAllowed(post({
      host: "lux.example",
      origin: "https://lux.example:8443",
      "sec-fetch-site": "same-origin",
    }))).toBe(true)
  })

  it("allows 8443 without Sec-Fetch-Site when the proxy forwards the port", () => {
    expect(requestOriginAllowed(post({
      host: "lux.example:8443",
      origin: "https://lux.example:8443",
    }))).toBe(true)
    expect(requestOriginAllowed(post({
      host: "lux.example:8443",
      origin: "https://lux.example:8006",
    }))).toBe(false)
  })

  it("rejects a cross-site origin and an origin header that lies about a cross-site fetch", () => {
    expect(requestOriginAllowed(post({
      host: "lux.example",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }))).toBe(false)
    expect(requestOriginAllowed(post({
      host: "lux.example",
      origin: "https://lux.example",
      "sec-fetch-site": "cross-site",
    }))).toBe(false)
  })
})
