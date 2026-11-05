import { test, expect } from "@playwright/test"

test.describe("login page UI", () => {
  test("shows sign-in form and disables submit until fields filled", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("heading", { name: /Sign In/i })).toBeVisible()
    const submit = page.getByRole("button", { name: /sign in/i })
    await expect(submit).toBeDisabled()

    await page.locator("#username").fill("x")
    await expect(submit).toBeDisabled()

    await page.locator("#password").fill("y")
    await expect(submit).toBeEnabled()
  })

  test("login page shows Ludus UX branding", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("heading", { name: /Ludus UX/i }).first()).toBeVisible()
  })
})
