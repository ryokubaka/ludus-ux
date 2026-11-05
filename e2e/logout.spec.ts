import { test, expect } from "@playwright/test"
import { loginAsAdmin, headerAccountMenuTrigger } from "./helpers/auth"

test.describe("logout", () => {
  test("Sign Out returns to login", async ({ page }) => {
    await loginAsAdmin(page, "/")
    await expect(page).not.toHaveURL(/\/login/)

    await headerAccountMenuTrigger(page).click()
    await page.getByRole("menuitem", { name: /^Sign Out$/ }).click()

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })
})
