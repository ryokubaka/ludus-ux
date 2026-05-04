import { expect, test, type Page } from "@playwright/test"

export const e2eAdminUser = process.env.E2E_ADMIN_USER || "adminuser"
export const e2eAdminPass = process.env.E2E_ADMIN_PASSWORD || "test"
export const e2eLudusApiKey = process.env.E2E_LUDUS_API_KEY || ""

/** Header user dropdown (not sidebar range selector, which also shows the username). */
export function headerAccountMenuTrigger(page: Page) {
  return page.getByRole("banner").getByRole("button", { name: new RegExp(e2eAdminUser) })
}

/**
 * Full admin login (credentials + optional Ludus API key step).
 * Uses `next` query so post-login lands on `nextPath`.
 */
export async function loginAsAdmin(page: Page, nextPath = "/"): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`)
  await page.locator("#username").fill(e2eAdminUser)
  await page.locator("#password").fill(e2eAdminPass)
  await page.getByRole("button", { name: /sign in/i }).click()

  const apiKeyHeading = page.getByRole("heading", { name: /SSH Connected/i })
  if (await apiKeyHeading.isVisible({ timeout: 12_000 }).catch(() => false)) {
    if (!e2eLudusApiKey) {
      test.skip(true, "Login requires API key step — set E2E_LUDUS_API_KEY for full run")
    }
    await page.locator("#api-key").fill(e2eLudusApiKey)
    await page.getByRole("button", { name: /Save & Continue/i }).click()
  }

  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 })
  if (nextPath !== "/" && nextPath !== "") {
    await expect(page).toHaveURL(new RegExp(`${nextPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?|$)`), {
      timeout: 15_000,
    })
  }
}
