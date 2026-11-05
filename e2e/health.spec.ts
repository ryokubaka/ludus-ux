import { test, expect } from "@playwright/test"

test.describe("public health", () => {
  test("GET /api/health returns ok JSON", async ({ request }) => {
    const res = await request.get("/api/health")
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toMatchObject({ status: "ok" })
    expect(typeof body.timestamp).toBe("string")
  })
})
