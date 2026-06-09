import { test, expect } from "@playwright/test"
import { loginAsAdmin } from "./helpers/auth"
import {
  extensionsTabPanel,
  historyTabPanel,
  openFirstGoadInstance,
} from "./helpers/goad"

test.describe("GOAD instance tabs (authenticated)", () => {
  test.describe.configure({ timeout: 120_000 })

  let instanceId = ""

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, "/")
    instanceId = await openFirstGoadInstance(page)
  })

  test("extensions tab shows guidance or extension lists", async ({ page }) => {
    await page.getByRole("tab", { name: /Extensions/i }).click()
    await expect(extensionsTabPanel(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("tab", { name: /Extensions/i })).toHaveAttribute("data-state", "active")
  })

  test("history tab shows correlated list or empty state", async ({ page }) => {
    await page.getByRole("tab", { name: /Logs History/i }).click()
    await expect(historyTabPanel(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("tab", { name: /Logs History/i })).toHaveAttribute("data-state", "active")
  })

  test("history tab refresh control is available", async ({ page }) => {
    await page.getByRole("tab", { name: /Logs History/i }).click()
    await expect(historyTabPanel(page)).toBeVisible({ timeout: 30_000 })
    const panel = page.getByRole("tabpanel").filter({
      hasText: /Deployment history for this instance|No recorded operations for this instance yet/,
    })
    await expect(panel.getByRole("button").first()).toBeVisible()
    await expect(panel.getByRole("button").first()).toBeEnabled()
  })

  test("?tab=extensions deep-link opens extensions panel", async ({ page }) => {
    await page.goto(`/goad/${encodeURIComponent(instanceId)}?tab=extensions`)
    await expect(page.getByRole("tab", { name: /Extensions/i })).toHaveAttribute("data-state", "active", {
      timeout: 30_000,
    })
    await expect(extensionsTabPanel(page)).toBeVisible({ timeout: 15_000 })
  })

  test("?tab=history deep-link opens history panel", async ({ page }) => {
    await page.goto(`/goad/${encodeURIComponent(instanceId)}?tab=history`)
    await expect(page.getByRole("tab", { name: /Logs History/i })).toHaveAttribute("data-state", "active", {
      timeout: 30_000,
    })
    await expect(historyTabPanel(page)).toBeVisible({ timeout: 30_000 })
  })
})
