import { test, expect } from "@playwright/test"

test.describe("GOAD task API (unauthenticated)", () => {
  test("GET /api/goad/tasks returns 401 without session", async ({ request }) => {
    const res = await request.get("/api/goad/tasks")
    expect(res.status()).toBe(401)
  })

  test("PATCH /api/goad/tasks/x returns 401 without session", async ({ request }) => {
    const res = await request.patch("/api/goad/tasks/goad-test-id", {
      data: { phase: null },
    })
    expect(res.status()).toBe(401)
  })

  test("POST link-instance returns 401 without session", async ({ request }) => {
    const res = await request.post("/api/goad/tasks/goad-test-id/link-instance", {
      data: { instanceId: "alice-goad-mini" },
    })
    expect(res.status()).toBe(401)
  })
})
