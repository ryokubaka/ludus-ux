import { expect, test, type Page } from "@playwright/test"

interface GoadInstanceRow {
  instanceId: string
}

async function fetchInstanceIds(page: Page, adminView = false): Promise<string[]> {
  const url = adminView ? "/api/goad/instances?adminView=1" : "/api/goad/instances"
  const res = await page.request.get(url)
  if (!res.ok()) return []

  const body = (await res.json()) as { configured?: boolean; instances?: GoadInstanceRow[] }
  if (!body.configured) return []
  return (body.instances ?? []).map((i) => i.instanceId).filter(Boolean)
}

async function instanceDetailReady(page: Page, instanceId: string): Promise<boolean> {
  await page.goto(`/goad/${encodeURIComponent(instanceId)}`)
  const notFound = page.getByText(new RegExp(`Instance.*${instanceId}.*not found`, "i"))
  if (await notFound.isVisible({ timeout: 5_000 }).catch(() => false)) return false
  await expect(page.getByRole("tab", { name: /Deploy Status/i })).toBeVisible({ timeout: 45_000 })
  return true
}

/**
 * Open the first GOAD instance detail page the session can actually load.
 * Skips when GOAD SSH is off or no accessible instances exist.
 */
export async function openFirstGoadInstance(page: Page): Promise<string> {
  const scoped = await fetchInstanceIds(page, false)
  const admin = await fetchInstanceIds(page, true)
  const candidates = [...new Set([...scoped, ...admin])]

  if (candidates.length === 0) {
    await page.goto("/goad")
    const sshAlert = page.getByText("GOAD SSH not configured")
    if (await sshAlert.isVisible({ timeout: 8_000 }).catch(() => false)) {
      test.skip(true, "GOAD SSH not configured in this environment")
    }
    test.skip(true, "No GOAD instances on server")
  }

  for (const instanceId of candidates) {
    if (await instanceDetailReady(page, instanceId)) return instanceId
  }

  test.skip(true, "No accessible GOAD instance detail pages")
  return ""
}

export function extensionsTabPanel(page: Page) {
  return page.getByRole("tabpanel").filter({
    hasText: /Install.*runs providing|No extensions available for this lab|Available to Install/i,
  })
}

export function historyTabPanel(page: Page) {
  return page.getByRole("tabpanel").filter({
    hasText: /Deployment history for this instance|No recorded operations for this instance yet/i,
  })
}
