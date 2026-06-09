import { defineConfig, devices } from "@playwright/test"

/**
 * E2E against Docker HTTPS (default https://localhost) or plain dev server.
 * First run: `npx playwright install`
 *
 * Env:
 *   PLAYWRIGHT_BASE_URL  — default https://localhost
 *   E2E_ADMIN_USER / E2E_ADMIN_PASSWORD — login
 *   E2E_IMPERSONATE_USER — /users row to impersonate (default testuser)
 *   E2E_LUDUS_API_KEY    — if login stops at "set-api key", paste Ludus key once
 *
 * Specs: health + auth-gate + login-ui (unauthenticated); navigation + logout + impersonation (authenticated); perf-refresh (metrics JSON).
 */
export default defineConfig({
  testDir: "../e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://localhost",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Optional: PW_CHANNEL=chrome|msedge when bundled Chromium is not installed
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL as "chrome" | "msedge" } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
