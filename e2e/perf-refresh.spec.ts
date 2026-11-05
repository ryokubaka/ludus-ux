import { test, expect, type Request, type Response } from "@playwright/test"
import { loginAsAdmin } from "./helpers/auth"

test.describe.configure({ mode: "serial" })

function bucketFor(url: string): string | null {
  try {
    const u = new URL(url)
    const p = u.pathname
    if (p.includes("/api/auth/session")) return "api/auth/session"
    if (p.includes("/api/auth/impersonate")) return "api/auth/impersonate"
    if (p === "/api/settings") return "api/settings"
    if (p.includes("/api/proxy/ranges/accessible")) return "api/proxy/ranges/accessible"
    if (url.includes("_rsc=")) return "next_rsc"
    return null
  } catch {
    return null
  }
}

function createTally() {
  const counts: Record<string, number> = {}
  const maxMs: Record<string, number> = {}
  const reqStarts = new WeakMap<Request, number>()

  function onRequest(req: Request) {
    reqStarts.set(req, Date.now())
  }

  function onResponse(res: Response) {
    const b = bucketFor(res.url())
    if (!b) return
    counts[b] = (counts[b] ?? 0) + 1
    const t0 = reqStarts.get(res.request())
    const ms = t0 ? Math.max(0, Date.now() - t0) : 0
    maxMs[b] = Math.max(maxMs[b] ?? 0, ms)
  }

  return { onRequest, onResponse, snapshot: () => ({ counts: { ...counts }, maxMs: { ...maxMs } }) }
}

test.describe("perf refresh metrics", () => {
  test("hard reload: dashboard + settings (request buckets)", async ({ page }, testInfo) => {
    await loginAsAdmin(page, "/")
    await expect(page.getByRole("banner").getByRole("heading", { level: 2 })).toBeVisible({ timeout: 30_000 })

    const scenarios: Array<{
      label: string
      counts: Record<string, number>
      maxMs: Record<string, number>
      navigation: {
        domContentLoaded: number
        loadEventEnd: number
        duration: number
      } | null
    }> = []

    async function measure(label: string) {
      const tally = createTally()
      page.on("request", tally.onRequest)
      page.on("response", tally.onResponse)
      await page.reload({ waitUntil: "domcontentloaded" })
      await expect(page.getByRole("banner").getByRole("heading", { level: 2 })).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(2500)
      page.removeListener("request", tally.onRequest)
      page.removeListener("response", tally.onResponse)
      const navigation = await page.evaluate(() => {
        const e = performance.getEntriesByType("navigation").at(-1) as PerformanceNavigationTiming | undefined
        if (!e) return null
        return {
          domContentLoaded: Math.round(e.domContentLoadedEventEnd - e.fetchStart),
          loadEventEnd: Math.round(e.loadEventEnd - e.fetchStart),
          duration: Math.round(e.duration),
        }
      })
      scenarios.push({ label, ...tally.snapshot(), navigation })
    }

    await measure("dashboard_reload")

    await page.goto("/settings")
    await expect(page.getByRole("banner").getByRole("heading", { level: 2, name: /Settings/i })).toBeVisible({
      timeout: 30_000,
    })
    await measure("settings_reload")

    const report = {
      generatedAt: new Date().toISOString(),
      gitSha: process.env.GITHUB_SHA || process.env.GIT_SHA || "",
      baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://localhost",
      scenarios,
    }

    await testInfo.attach("perf-metrics.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    })

    // Soft guardrails — tune after baseline; main value is the JSON artifact for diffing branches.
    const dash = scenarios.find((s) => s.label === "dashboard_reload")
    expect(dash?.counts["api/auth/session"] ?? 0).toBeLessThanOrEqual(3)
  })
})
