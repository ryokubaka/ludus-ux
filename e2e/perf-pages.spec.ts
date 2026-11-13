import { test, expect } from "@playwright/test"
import { loginAsAdmin } from "./helpers/auth"
import { createApiTally, type ApiPathMetrics } from "./helpers/perf"

test.describe.configure({ mode: "serial" })

const ROUTES = [
  { path: "/", label: "dashboard" },
  { path: "/settings", label: "settings" },
  { path: "/admin", label: "admin" },
  { path: "/goad", label: "goad" },
  { path: "/testing", label: "testing" },
  { path: "/sources", label: "sources" },
  { path: "/users", label: "users" },
  { path: "/templates", label: "templates" },
]

interface RouteReport {
  route: string
  label: string
  documentStatus: number
  navigation: {
    domContentLoaded: number
    loadEventEnd: number
    duration: number
  } | null
  apiRequests: Record<string, ApiPathMetrics>
  postLoadApiRequests: number
}

test.describe("per-route performance metrics", () => {
  test("records navigation, API request, and post-load polling metrics", async ({ page }, testInfo) => {
    await loginAsAdmin(page, "/")
    await expect(page.locator("#main-content")).toBeVisible({ timeout: 30_000 })

    const reports: RouteReport[] = []

    for (const route of ROUTES) {
      const tally = createApiTally()
      page.on("request", tally.onRequest)
      page.on("response", tally.onResponse)

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 45_000 })
      await expect(page.locator("#main-content")).toBeVisible({ timeout: 45_000 })

      // Let the page finish its initial data load, then start the post-load
      // window. Polls that fire after this point are counted separately.
      await page.waitForTimeout(1_500)
      tally.markLoaded()
      await page.waitForTimeout(2_000)

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

      const snapshot = tally.snapshot()
      reports.push({
        route: route.path,
        label: route.label,
        documentStatus: response?.status() ?? 0,
        navigation,
        apiRequests: snapshot.apiRequests,
        postLoadApiRequests: snapshot.postLoadApiRequests,
      })
    }

    const report = {
      generatedAt: new Date().toISOString(),
      gitSha: process.env.GITHUB_SHA || process.env.GIT_SHA || "",
      baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://localhost",
      routes: reports,
    }

    await testInfo.attach("perf-pages.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    })

    for (const report of reports) {
      expect(report.documentStatus, `${report.route} document status`).toBeLessThan(400)
      expect(report.navigation, `${report.route} navigation timing`).not.toBeNull()
      // Soft guardrail: a visibly loaded page should not keep issuing a burst
      // of API calls. Polling pages are allowed a small number.
      expect(
        report.postLoadApiRequests,
        `${report.route} post-load API requests`,
      ).toBeLessThanOrEqual(12)
      const unauthorized = Object.keys(report.apiRequests)
        .flatMap((path) => Object.keys(report.apiRequests[path]!.statuses))
        .filter((status) => status === "401")
      expect(unauthorized, `${report.route} unauthorized API responses`).toHaveLength(0)
    }
  })
})
