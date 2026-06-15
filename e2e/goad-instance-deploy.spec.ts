import { test, expect } from "@playwright/test"
import { loginAsAdmin } from "./helpers/auth"
import { openFirstGoadInstance } from "./helpers/goad"

test.describe("GOAD instance deploy tab (authenticated)", () => {
  test.describe.configure({ timeout: 120_000 })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, "/")
    await openFirstGoadInstance(page)
  })

  test("deploy tab shows action bar and split log panels", async ({ page }) => {
    await page.getByRole("tab", { name: /Deploy Status/i }).click()
    await expect(page.getByRole("tab", { name: /Deploy Status/i })).toHaveAttribute("data-state", "active")

    await expect(page.getByRole("button", { name: /^Status$/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Provide$/ })).toBeVisible()

    const panel = page.getByRole("tabpanel").filter({ hasText: /Range Logs|GOAD Logs|action button above/i })
    await expect(panel).toBeVisible({ timeout: 15_000 })
  })

  test("?tab=deploy deep-link opens deploy panel", async ({ page }) => {
    const instanceId = decodeURIComponent(new URL(page.url()).pathname.replace(/^\/goad\//, ""))
    await page.goto(`/goad/${encodeURIComponent(instanceId)}?tab=deploy`)
    await expect(page.getByRole("tab", { name: /Deploy Status/i })).toHaveAttribute("data-state", "active", {
      timeout: 30_000,
    })
    await expect(page.getByRole("button", { name: /^Install$/ })).toBeVisible()
  })
})
