import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { clientIpFromRequest } from "./security-audit-log"

describe("clientIpFromRequest", () => {
  it("reads X-Real-IP and ignores a spoofed X-Forwarded-For", () => {
    const request = new NextRequest("https://lux.example/api/auth/login", {
      headers: {
        "x-forwarded-for": "203.0.113.9, 192.0.2.1",
        "x-real-ip": "198.51.100.8",
      },
    })
    expect(clientIpFromRequest(request)).toBe("198.51.100.8")
  })

  it("does not trust X-Forwarded-For when X-Real-IP is absent", () => {
    const request = new NextRequest("https://lux.example/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    })
    expect(clientIpFromRequest(request)).toBe("unknown")
  })
})
