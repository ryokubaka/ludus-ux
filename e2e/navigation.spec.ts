import { test, expect, type Page } from "@playwright/test"
import { loginAsAdmin, headerAccountMenuTrigger } from "./helpers/auth"

async function expectHeaderTitle(page: Page, title: string | RegExp) {
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: title })).toBeVisible({
    timeout: 30_000,
  })
}

test.describe("authenticated navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, "/")
  })

  test("sidebar: core range pages load with correct header titles", async ({ page }) => {
    await expectHeaderTitle(page, "Dashboard")

    await page.getByRole("link", { name: /^Templates$/ }).click()
    await expectHeaderTitle(page, "Templates")

    await page.getByRole("link", { name: /^Range Logs$/ }).click()
    await expectHeaderTitle(page, "Range Logs")

    await page.getByRole("link", { name: /^Blueprints$/ }).click()
    await expectHeaderTitle(page, "Blueprints")

    await page.getByRole("link", { name: /^Snapshots$/ }).click()
    await expectHeaderTitle(page, "Snapshots")

    await page.getByRole("link", { name: /^Settings$/ }).click()
    await expectHeaderTitle(page, "Settings")
  })

  test("header user menu: User Settings page", async ({ page }) => {
    await headerAccountMenuTrigger(page).click()
    await page.getByRole("menuitem", { name: /User Settings/i }).click()
    await expectHeaderTitle(page, "User Settings")
  })

  test("admin sidebar: Users and Ranges Overview when admin", async ({ page }) => {
    const usersLink = page.getByRole("link", { name: /^Users$/ })
    await expect(usersLink).toBeVisible({ timeout: 25_000 })
    await usersLink.click()
    await expectHeaderTitle(page, "Users")

    await page.getByRole("link", { name: /^Ranges Overview$/ }).click()
    await expect(page.getByText("Total Ranges")).toBeVisible({ timeout: 30_000 })
  })

  test("GOAD Management link when integration enabled", async ({ page }) => {
    const goad = page.getByRole("link", { name: /^GOAD Management$/ })
    if (!(await goad.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, "GOAD nav hidden (goadEnabled false or still loading)")
    }
    await goad.click()
    await expectHeaderTitle(page, "GOAD Management")
  })
})
