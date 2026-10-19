# Development

```bash
npm install
npm run dev
# http://localhost:3000
```

Local dev does **not** use Compose nginx; unset **`TRUST_PROXY_TLS`** / **`DISABLE_HTTPS`** or set **`DISABLE_HTTPS=false`** so cookies match plain HTTP. The **Docker Compose** stack uses **`DISABLE_HTTPS=true`** + **`TRUST_PROXY_TLS=true`** with nginx on **:443** instead.

## E2E (Playwright)

With the stack up and HTTPS (e.g. `docker compose up`, `https://localhost`), install browsers once: `npx playwright install` (Linux/WSL: `npx playwright install-deps chromium` if the runner errors on missing `.so` libraries).

```bash
# Optional: PLAYWRIGHT_BASE_URL=https://localhost
# If login stops at Ludus API key: E2E_LUDUS_API_KEY='...'
# If Chromium is missing locally: PW_CHANNEL=chrome npm run test:e2e
npm run test:e2e
npm run test:perf
```

`test:perf` runs [`e2e/perf-refresh.spec.ts`](../e2e/perf-refresh.spec.ts) and attaches `perf-metrics.json` for branch-to-branch comparison (`node e2e/scripts/compare-perf.mjs before.json after.json`).

Config file: [`config/playwright.config.ts`](../config/playwright.config.ts).

Default creds: `E2E_ADMIN_USER=adminuser`, `E2E_ADMIN_PASSWORD=test`, `E2E_IMPERSONATE_USER=testuser`. **Unauthenticated** specs (`e2e/health.spec.ts`, `auth-gate`, `login-ui`, `goad-task-acl`) only need the app reachable. **Authenticated** specs (`navigation`, `logout`, `impersonation`, `goad-instance-tabs`, `goad-instance-deploy`) need valid SSH login and at least one GOAD instance when testing instance tabs; impersonation may need `E2E_LUDUS_API_KEY`. Shared helpers: `e2e/helpers/auth.ts`, `e2e/helpers/goad.ts`. WSL notes: [`playwright.yaml`](playwright.yaml).

## CI

Opening a pull request sets the title to `vX.Y.Z - Feature, feature, and feature` and the description to a **Summary** list taken from that version's section in `CHANGELOG.md`. A branch named `vX.Y.Z` uses `## [X.Y.Z]`. Otherwise the job uses `## Unreleased`, then the newest versioned section. Later pushes refresh the description while it contains `<!-- lux-pr-summary -->`. Delete that comment to keep a hand-edited title and description.

Merging to `main` tags `vX.Y.Z` and publishes that changelog section (`.github/workflows/release.yml`).
