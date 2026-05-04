import { test, expect } from "@playwright/test"

test.describe("auth gates (unauthenticated)", () => {
  test("root redirects to login with next=/", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login/)
    const u = new URL(page.url())
    expect(u.searchParams.get("next")).toBe("/")
  })

  test("deep link preserves next= for protected route", async ({ page }) => {
    await page.goto("/templates")
    await expect(page).toHaveURL(/\/login/)
    const u = new URL(page.url())
    expect(u.searchParams.get("next")).toBe("/templates")
  })

  test("GET /api/auth/session without cookie returns 401", async ({ request }) => {
    const res = await request.get("/api/auth/session")
    expect(res.status()).toBe(401)
    const body = (await res.json()) as { authenticated?: boolean; error?: string }
    // middleware returns { error } for unauthenticated /api/*; route handler would use { authenticated: false }
    expect(
      body.authenticated === false ||
        (typeof body.error === "string" && /not authenticated/i.test(body.error)),
    ).toBe(true)
  })

  test("GET /api/settings without cookie returns 401", async ({ request }) => {
    const res = await request.get("/api/settings")
    expect(res.status()).toBe(401)
  })
})
