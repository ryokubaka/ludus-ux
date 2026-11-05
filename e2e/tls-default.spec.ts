import { test, expect } from "@playwright/test"

test.describe("health and defaults", () => {
  test("GET /api/health is public", async ({ request }) => {
    const res = await request.get("/api/health")
    expect(res.ok()).toBe(true)
  })

  test("GET /api/logo is public (favicon)", async ({ request }) => {
    const res = await request.get("/api/logo")
    expect(res.status()).toBeLessThan(500)
  })
})
