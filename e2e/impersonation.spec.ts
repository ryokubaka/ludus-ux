import { test, expect } from "@playwright/test"
import { loginAsAdmin, e2eLudusApiKey } from "./helpers/auth"

const targetUser = process.env.E2E_IMPERSONATE_USER || "testuser"

test.describe("LUX auth + impersonation scope", () => {
  test("login then impersonate shows scoped banner", async ({ page }) => {
    await loginAsAdmin(page, "/")

    await page.goto("/users")
    const row = page.getByRole("row", { name: new RegExp(targetUser, "i") }).first()
    await expect(row).toBeVisible({ timeout: 25_000 })
    await row.getByRole("button", { name: /^Manage$/ }).click()

    const manualDialog = page.getByRole("heading", { name: /Manage as/i })
    if (await manualDialog.isVisible({ timeout: 8_000 }).catch(() => false)) {
      if (!e2eLudusApiKey) {
        test.skip(true, "Impersonation needs API key — set E2E_LUDUS_API_KEY")
      }
      await page.locator("#users-impersonate-apikey").fill(e2eLudusApiKey)
      await page.getByRole("button", { name: /Manage Ludus Ranges/i }).click()
    }

    await expect(page.getByText(new RegExp(`Viewing.*managing as.*${targetUser}`, "i"))).toBeVisible({
      timeout: 30_000,
    })
  })
})
