# LUX performance and data-integrity audit — Phase 1

Status: Phase 1 deliverable, with Phase 2A correctness and observability fixes,
Phase 2B hot-path changes, Phase 2C cache isolation, Phase 2D responsive
UI/accessibility work, Phase 3 polling/admin fan-out fixes, and Phase 4
server timing/cache telemetry implemented. The audit itself was read-only;
Phases 2–4 changed application source and are listed in §11–§16.

Date: 2026-11-12

Baseline environment: deployed LUX v1.6.0 (`/api/health` reports `1.6.0`) at
`https://10.8.0.176`, reached from the audit container through the host gateway
as `https://172.28.16.1` (same nginx/LUX instance). Login: `adminuser`.
Raw harness output: [`perf-baseline-v1.6.0.json`](perf-baseline-v1.6.0.json).

## 1. Executive summary

LUX is functionally dense: one Next.js process fronts a Ludus API, a host SSH
channel, and a local SQLite/PocketBase state store. The audit found that the
dominant risks are not raw React rendering speed. They are:

1. **State can be shown as current when it is stale or unavailable.** The
   dashboard deliberately keeps the previous range snapshot when Ludus returns
   HTTP 400, then refreshes `dataUpdatedAt`, so a failed poll looks like a
   successful one. The VM table has no error input and prints "No VMs deployed
   yet" for an empty, failed, or unloaded list. Several `?? []` and
   `.catch(() => [])` paths turn transport failures into empty collections.
   Confirmed policy: stale data is acceptable only during an **active**
   refresh/reconnect (network loss, host unreachable), and the UI must show that
   activity. It must not silently persist stale data as current.
2. **Repeated SSH work sits on interactive paths.** GOAD instance listing is an
   uncached SSH + Python call used by every non-admin instance route and by a
   3-second deploy-link poll. Admin shared-VM discovery runs two serial `pvesh`
   calls per VM. A deploy POST runs seven serial host-patch SSH operations
   before it reaches Ludus.
3. **Deploy/log observability duplicates work.** The log stream polls Ludus and
   SSH every two seconds while the browser separately polls deploy history and
   detail every two seconds. The client poll suppresses the SSE log lines it is
   meant to display.
4. **Cache policy is coarse in both directions.** Range mutations invalidate
   global tags, so one range change refreshes every scope. At the same time the
   in-process `SWRCache` has no size bound or eviction, and `"use cache"`
   fetchers key on raw API keys even though a hashed partition helper exists.
5. **Large tables and narrow viewports are not handled.** The VM table renders
   every row, the shell reserves a fixed 64-unit sidebar and hides horizontal
   overflow, and the base dialog has no height cap or scroll region.

Severity counts: **6 P0**, **12 P1**, **7 P2**, **1 P3** (26 findings). The
top-10 sequence in §9 starts with correctness fixes because they are small and
independent, then removes SSH/duplicate polling from interactive paths, then
tightens caching, then addresses table/viewport behavior.

A live baseline was captured against the deployed v1.6.0 instance: hard-reload
navigation was 0.8–1.2 s and warm in-session navigation was 111–318 ms for the
measured routes. The harness records maximum latency, not p50/p95; percentiles
and server-side timing are Phase 2 instrumentation. Expected benefits stated in
findings are derived from code structure (serial round trips removed), not from
a production run.

## 2. Scope and method

Audited:

- `src/app/**` pages and route handlers, `src/components/**`, `src/lib/**`,
  `src/proxy.ts`, `config/next.config.cjs`, `package.json`.
- Request flow from browser to `/api/proxy`, `ludusRequest`, `sshExec` /
  lux-host, SQLite, and PocketBase.
- React Query configuration, server prefetch/hydration, `"use cache"` tags,
  in-process SWR, and mutation invalidation.
- Deploy log SSE and client-side log polling.
- Large tables, dialogs, shell layout, and target viewport sizes.

Not audited in this phase:

- Packer build performance and Ansible playbook runtime on the host.
- nginx/TLS tuning beyond configuration reading.
- p50/p95 distributions. The existing harness records navigation duration and
  maximum latency; percentiles require the Phase 2 extension in §4.4.

Live baseline: the deployed v1.6.0 instance was exercised on 2026-11-12 with
`npm run test:perf` and a per-route request probe. Results are in §4.5. The
worktree HEAD is one commit after v1.6.0; the measured instance is the deployed
v1.6.0 build, not a build of this worktree.

Evidence standard: every finding cites a file and line. Where behavior depends
on a runtime call, the code path is quoted rather than inferred.

## 3. Architecture and request lifecycle

### 3.1 Trust boundaries and transports

```
browser
  │  same-origin fetch / EventSource
  ▼
src/proxy.ts  ── session gate, security headers
  ▼
src/app/api/** route handlers
  ├── /api/proxy/[[...path]] ──► ludusRequest ──► Ludus API (HTTP)
  │      ├── liveSessionIsAdmin (60 s cache)
  │      ├── POST /range/deploy: assertRouterTemplateReady + 7 serial lux-host patches
  │      └── mutating calls: revalidate tags + optional Ansible-home repair over SSH
  ├── /api/goad/** ──► listGoadInstances / streamGoadCommand (SSH + Python)
  ├── /api/admin/** ──► pvesh over host SSH
  ├── /api/logs/stream ──► Ludus log cursor + SSH log tail every 2 s
  ├── /api/range/pb-status ──► PocketBase / SQLite
  └── /api/settings ──► SQLite (secrets `enc:v2:`)
```

Server pages prefetch through `src/lib/core/server-prefetch.ts` into a
dehydrated React Query cache. The global shell (`AuthenticatedRoot`) prefetches
accessible ranges and, for non-impersonating sessions, the Ludus version. Page
prefetch is range-scoped through `prefetchRangePageData(session, slices)`.

### 3.2 Server prefetch slices by page

| Page | Prefetch slices | Primary client fan-out |
|---|---|---|
| `/` dashboard | status, logHistory, logEnrichment | range status 15 s, deploy history 15 s, GOAD by-range, GOAD tasks 3 s while busy |
| `/logs` | logHistory, logEnrichment | log history/detail/clock polls plus SSE |
| `/testing` | logHistory, logEnrichment | one PB status query per sidebar range, selected status, 3 s op poll, EFI preview |
| `/snapshots` | snapshots | snapshots list |
| `/range/config`, `/range/builder` | config, status | config, templates/blueprints as needed |
| `/sources` | sources list | sources list + per-source operations |
| `/templates` | templates | templates |
| `/blueprints` | blueprints | blueprints + templates |
| `/ansible` | ansible | ansible |
| `/users` | users | users + admin data |
| `/groups` | groups | groups |
| `/admin` | admin data | admin data, shared VMs, range VMs |
| `/goad`, `/goad/[id]` | none | uncached SSH instance listing + task polls |

Code-derived fan-out is the important part: a page that looks like one route can
trigger one HTTP call per range (testing dots), one SSH call per instance route
(GOAD), or two serial SSH calls per VM (admin shared VMs).

### 3.3 Caching layers

| Layer | Location | TTL / behavior | Isolation |
|---|---|---|---|
| Browser React Query | `src/lib/ui/query-client.ts` | global `staleTime` 30 s, retry twice on non-4xx, refetch on window focus | `queryKeys` include `effectiveScopeTag` |
| Server L1 SWR | `src/lib/core/server-cache.ts` | per-key TTL, stale-while-revalidate, no eviction | key built from API key + scope/range |
| Next `"use cache"` L2 | `src/lib/ludus/cached-ludus-fetch.ts` | `cacheLife` 15–300 s, tags per resource/scope | `scopeTag` in tag and args |
| SQLite (LUX) | `src/lib/**` stores | LUX-owned local state (settings, ops, logs) | user/range columns |
| PocketBase (Ludus) | `src/lib/core/pocketbase-client.ts` | Ludus backend store; read directly for persisted range/user state | server-side root key |

Invalidation paths:

- `src/lib/ludus/ludus-cache-revalidate.ts` revalidates resource + scope tags.
- `src/lib/ludus/ludus-proxy-cache-invalidate.ts` revalidates **global** range
  tags after mutations and calls `invalidateInProcessLudusCachesAfterMutation`.
- `src/lib/ludus/ludus-swr-invalidate.ts` clears L1 entries for an API key.

## 4. Reproducible baseline

### 4.1 What exists

`npm run test:perf` runs `e2e/perf-refresh.spec.ts`. It logs in as admin, then
for `dashboard_reload` and `settings_reload` records:

- request counts for `/api/auth/session`, `/api/auth/impersonate`,
  `/api/settings`, `/api/proxy/ranges/accessible`, and `_rsc` navigations;
- maximum observed latency per bucket;
- `performance.getEntriesByType("navigation")` timings;
- a `perf-metrics.json` attachment with `generatedAt`, `gitSha`, `baseURL`, and
  the scenario array.

`e2e/scripts/compare-perf.mjs before.json after.json` prints a side-by-side
table. The only hard guardrail is `api/auth/session <= 3` on dashboard reload.

### 4.2 Commands

```bash
# Local stack built from this worktree
docker compose up -d --build ludus-ux
docker inspect --format '{{.State.Health.Status}}' ludus-ux

PLAYWRIGHT_BASE_URL=https://localhost \
E2E_ADMIN_USER="$E2E_ADMIN_USER" E2E_ADMIN_PASSWORD="$E2E_ADMIN_PASSWORD" \
npm run test:perf

# Measured baseline: deployed v1.6.0. Set the admin user and password in the environment.
PLAYWRIGHT_BASE_URL=https://10.8.0.176 \
E2E_ADMIN_USER="$E2E_ADMIN_USER" E2E_ADMIN_PASSWORD="$E2E_ADMIN_PASSWORD" \
npm run test:perf
```

`E2E_ADMIN_USER` and `E2E_ADMIN_PASSWORD` are required. If the first login
shows the "SSH Connected" API-key step, set `E2E_LUDUS_API_KEY`. When bundled
Chromium is missing, set `PW_CHANNEL=chrome`. Host `npm run dev` must unset
`TRUST_PROXY_TLS` so cookies match plain HTTP.

From the audit container, `10.8.0.176` was not directly routable. The host
gateway `https://172.28.16.1` served the same nginx/LUX instance
(`/api/health` returned version `1.6.0`), so the baseline was run there and the
raw artifact records that base URL.

### 4.3 Gaps in the current harness

The harness does not capture:

- per-page request counts beyond the four buckets;
- p50/p95 (only maximum);
- time spent server-side inside `/api/proxy`, SSH calls, or SQLite;
- cache hit/miss and stale-serve counts;
- table render cost with large VM/range lists;
- interaction latency for dialogs, tabs, search, and row actions;
- log update cadence and duplicate lines.

### 4.4 Proposed baseline extension (Phase 2 instrumentation)

Add a Playwright spec `e2e/perf-pages.spec.ts` that iterates a fixed route list
and records, per route: navigation timing, request count by `/api/*` path,
response status distribution, and the number of requests after the page is
"visibly loaded". Add a server timing header (`Server-Timing`) to `/api/proxy`
and the SSH-backed routes, reporting upstream duration and cache status. Keep
`perf-refresh.spec.ts` unchanged as the regression guard.

Phase 2A status: `perf-refresh.spec.ts` now records p50/p95 per request bucket
and parses `Server-Timing`; `/api/proxy` emits auth, admin, body, preflight,
upstream, and total phases (disable with `LUX_SERVER_TIMING=0`). Phase 4 adds
`e2e/perf-pages.spec.ts` for the per-route metrics, `Server-Timing` on the
SSH-backed routes, and cache counters on `/api/metrics` (§16).

Minimum metric set for the Phase 2 report:

| Interaction | Metric | Target |
|---|---|---|
| Page load (authenticated) | p50/p95 TTFB, DCL, load | p95 < 1 s for cached shell, < 2.5 s cold |
| Sidebar navigation | p50/p95 time to heading + data | < 1 s |
| Range status refresh | p50/p95 and staleness flag | < 1 s, never silently stale |
| VM table (50/200 rows) | render time, memory, scroll FPS | no long task > 200 ms |
| Dialog open/close | p50/p95 | < 100 ms |
| Tab switch | p50/p95 | < 300 ms |
| Search/filter | p50/p95 keystroke-to-result | < 150 ms local |
| Deploy log update | p50/p95 line latency, duplicate rate | < 2 s, zero duplicates |
| API latency | p50/p95 by route | documented per route |
| Cache | hit/miss/stale-serve counts | no stale-serve without marker |

### 4.5 Measured baseline (deployed v1.6.0, 2026-11-12)

The existing harness records maximum latency, not p50/p95. Treat these as
single-run upper bounds, not percentiles.

Hard reload through `npm run test:perf` (three runs, same instance; median and
range across runs):

| Scenario | Request buckets | Max latency (ms) | Navigation (ms) |
|---|---|---|---|
| `dashboard_reload` | impersonate 3, RSC 31–35, settings 1, session 1–2 | impersonate 765–792, RSC 857–928, settings 250–406, session 785–1269 | median 1148, range 1094–1166 |
| `settings_reload` | settings 3, session 1–2, impersonate 3, RSC 30 | settings 652–749, session 541–639, impersonate 489–555, RSC 614–857 | median 893, range 786–993 |

Request counts were stable across runs. Maximum latency varied by up to ~40%
between runs, which is why the harness should move to p50/p95.

Warm in-session navigations (single sample, 2.5 s settle; `/api/*` requests
only, static assets excluded). These were collected with an ad hoc Playwright
probe using the same login flow; Phase 2 formalizes it as
`e2e/perf-pages.spec.ts`:

| Route | API requests | DCL (ms) | Notes |
|---|---|---|---|
| `/` | 14 | 111 | dashboard; hard reload above is 1370 ms |
| `/logs` | 13 | 220 | includes `/api/logs/stream` |
| `/testing` | 16 | 318 | pb-status, ops, allowed-domains |
| `/snapshots` | 12 | 146 | |
| `/range/config` | 11 | 140 | |
| `/range/builder` | 13 | 186 | |
| `/templates` | 16 | 272 | templates + per-source catalog |
| `/blueprints` | 16 | 155 | blueprints + per-source detail |
| `/ansible` | 13 | 203 | |
| `/sources` | 9 | 212 | |
| `/users` | 11 | 272 | |
| `/groups` | 10 | 155 | |
| `/admin` | 9 | 257 | tabs may lazy-load more |
| `/goad` | 3 | 152 | list page may lazy-load instance data |

What this establishes:

- Warm navigation is already under 1 s for every measured route.
- Hard reload is ~0.8–1.2 s and spends most of it in auth/RSC, not page data.
- Request counts are modest on warm loads (9–16 API calls), but the expensive
  paths are the ones that scale with ranges/VMs and are not visible in these
  counts: GOAD SSH listing, admin shared-VM discovery, and deploy-log polling.

Not yet captured: p50/p95, per-route server timing, cache hit/miss, VM-table
render cost at 200 rows, dialog/tab/search interaction latency, and duplicate
log-line rate. These are the Phase 2 extension targets in §4.4.

Raw harness output: [`perf-baseline-v1.6.0.json`](perf-baseline-v1.6.0.json).

## 5. Findings

Severity definitions:

- **P0** — can display wrong infrastructure state, hide a failure, or report an
  accepted async operation as complete.
- **P1** — common interaction exceeds the responsiveness target, or repeated
  backend cost scales with users/ranges/VMs.
- **P2** — UX, responsive, or accessibility defect that blocks a target viewport
  or makes state hard to read.
- **P3** — maintainability or observability gap that raises regression risk.

### P0 — data integrity and correctness

#### F-01: HTTP 400 range poll is relabeled as fresh

- Evidence: `src/app/_dashboard.tsx:229-236` returns the previous range object
  on status 400; `src/app/_dashboard.tsx:1249-1254` renders
  `rangeDataUpdatedAt` as a green "synced" timestamp.
- Impact: during deploy/log-stream startup Ludus can return 400. The UI keeps
  old VMs and state but moves the timestamp forward, so the user cannot tell
  that the poll failed. This directly violates "preserve verified data but mark
  staleness".
- Proposed solution: treat 400 as a **transient failure**, not fresh data.
  Keep the last verified snapshot only while an active retry/reconnect loop is
  running, and attach explicit metadata (`lastVerifiedAt`, `lastAttemptAt`,
  `refreshState: idle | refreshing | retrying | unavailable`, `lastError`).
  Render a spinner with "Refreshing — last verified HH:MM:SS" while retrying,
  and switch to "Unavailable — last verified HH:MM:SS" plus a manual retry when
  attempts exhaust. On success, replace the snapshot immediately and clear the
  stale flags. For auth/permission errors, show the error directly instead of
  retaining stale data.
- Expected benefit: removes the most misleading state in the product; no extra
  requests beyond the bounded retry.

#### F-02: VM union merge can retain VMs that no longer exist

- Evidence: `src/lib/ui/dashboard-vm-merge.ts:53-74` unions previous and next VM
  lists; `:104-174` applies the merge when the new list is empty/short, and
  `:169` uses pessimistic power state. The merge is keyed by VM identity.
- Impact: a genuinely destroyed VM can survive several polls because it is
  absent from the new list but present in `prevVMs`. The user sees a VM that
  Proxmox no longer has, and power actions fail against a missing VMID.
- Proposed solution: distinguish "partial response during an active refresh"
  from "authoritative response". Merge at most one poll, only while a refresh
  is visibly in progress, and mark merged-in rows "unconfirmed". When a
  verified response arrives, trust it: if `rangeState` is terminal and the
  count is consistent, replace the list (including empty). Do not retain rows
  across multiple successful polls just because they were once present.
- Expected benefit: no phantom VMs; bounded stale window tied to an active
  refresh.

#### F-03: VM table renders "No VMs deployed yet" for failed or unloaded state

- Evidence: `src/components/range/vm-table.tsx:471-477` branches only on
  `vms.length === 0`; `src/app/_dashboard.tsx:1680-1689` passes no error or
  loading prop.
- Impact: a failed status fetch, a permission failure, or a still-loading range
  all look identical to an empty range. Users may redeploy unnecessarily.
- Proposed solution: add `state: "loading" | "error" | "empty" | "ready"` and
  `error` props. Render distinct messages and a retry action. During an active
  refresh, keep the last verified rows visible with a refreshing banner; after
  retries exhaust, show the error/unavailable state instead of an empty table.
- Expected benefit: correctness and fewer unnecessary deploys.

#### F-04: Sources fetch failure is reported as a Ludus version problem

- Evidence: `src/app/api/sources/route.ts:55-62` returns `available: false`
  only for HTTP 404 and `502` with `{ error }` otherwise;
  `src/app/sources/_sources.tsx:1061` uses `data?.available ?? false`, and
  `:1236-1245` renders "Sources require Ludus 2.2.0 or newer" whenever
  `!sourcesAvailable && !isLoading`.
- Impact: a network error, auth failure, or Ludus 500 tells the user to upgrade
  Ludus. The actual error is not shown.
- Proposed solution: branch on the query error first ("Could not load sources —
  retry"), then on `available === false` for the version message. Preserve the
  distinction between not-supported, not-loaded, and failed.
- Expected benefit: correct diagnosis; no false upgrade advice.

#### F-05: Dashboard uses a cached Ludus view while testing reads PocketBase directly

- Evidence: Ludus uses PocketBase as its backend data store
  (<https://docs.ludus.cloud/docs/administration/pocketbase>). LUX reads it
  directly in `src/lib/core/pocketbase-client.ts`; `fetchPbRangeStatus` maps
  `rangeState`, `testingEnabled`, `numberOfVMs`, and allowed domains, and
  explicitly notes that PocketBase is authoritative while the Ludus REST API
  "may add a caching layer" (`src/lib/core/pocketbase-client.ts:232-250`).
  `src/app/testing/_testing.tsx:358-391` uses that PB view as the source of
  truth; `src/app/_dashboard.tsx:223-259` uses Ludus `/range` instead. Live VM
  state is not persisted in PocketBase (`mapRange` sets `VMs: []`).
- Impact: after an out-of-band change (CLI deploy, Proxmox action, another
  session), the dashboard can lag the testing page because it reads the cached
  Ludus API view. This is not two independent stores; it is one authoritative
  store (PocketBase) read through two paths with different freshness.
- Proposed solution: use PocketBase for persisted range fields on every page
  (state, testing flag, VM count, allowed domains) and Ludus `/range` only for
  live VM inventory. Merge them explicitly and label which fields came from
  which source. Keep destructive actions gated on the fresher PB state.
- Expected benefit: consistent state across pages; removes the dashboard's
  dependence on the cached Ludus status path (and the 400 fallback in F-01).

#### F-06: SSH listing failures become "no instances"

- Evidence: `src/lib/goad/goad-ssh.ts:1423-1441` returns `[]` on non-zero exit
  or empty stdout; `src/lib/goad/fetch-goad-instances-for-request.ts:45-60`
  returns `configured: true, instances: []` without an error for that case.
- Impact: a transient SSH failure makes GOAD look empty. The dashboard's
  by-range lookup returns `null`, so GOAD correlation disappears silently.
- Proposed solution: return a discriminated result
  (`ok | unavailable | empty`) from `listGoadInstances`, propagate it, and
  render "GOAD unavailable — retry" rather than an empty list. Cache a
  successful listing for a short TTL (see F-07).
- Expected benefit: correct GOAD visibility; fewer false empties.

### P1 — responsiveness and backend cost

#### F-07: GOAD instance listing is uncached SSH on every access check

- Evidence: `src/lib/goad/goad-ssh.ts:1423-1467` executes a base64-encoded
  Python script over SSH on every call. `src/lib/goad/fetch-goad-instances-for-request.ts:45-52`
  calls it for `/api/goad/instances` and `/api/goad/by-range`. Non-admin
  instance routes call it for access checks (e.g.
  `src/app/api/goad/instances/set-range/route.ts:54`,
  `src/app/api/goad/instances/[instanceId]/init-range/route.ts:156`).
- Impact: every GOAD page/route pays one SSH round trip; the dashboard's
  `goadInstanceForRange` query and the deploy-link poll multiply it.
- Proposed solution: add a short-TTL (5–10 s) in-process cache keyed by
  SSH user/creds + `scopeTag`, invalidated on GOAD mutations. Reuse the
  existing `SWRCache` pattern; do not add a new cache subsystem. Return the
  discriminated result from F-06 so a cache miss/failure is visible.
- Expected benefit: removes one SSH round trip per request (hundreds of ms
  typical); makes GOAD pages usable during deploys.

#### F-08: Admin shared-VM discovery is serial `pvesh` per VM

- Evidence: `src/app/api/admin/shared-vms/route.ts:61-108`: for each pool
  member, one `/nodes` call (when node is unknown), then
  `/status/current`, then `/agent/network-get-interfaces` — all awaited
  sequentially.
- Impact: 10 shared VMs can mean 20+ serial SSH commands before the admin page
  renders.
- Proposed solution: resolve `/nodes` once, then run per-VM status and network
  calls with bounded concurrency (`Promise.all` over a small pool). Cache the
  result for 10–15 s and expose a manual refresh.
- Expected benefit: latency scales with the slowest VM, not the sum; admin page
  becomes interactive.

#### F-09: Deploy POST runs seven serial host-patch SSH operations first

- Evidence: `src/app/api/proxy/[[...path]]/route.ts:106-128` awaits
  `assertRouterTemplateReady` and `ensureRangeDeployHostPatches`;
  `src/lib/range/range-deploy-host-patches.ts:229-237` awaits seven patch
  helpers in sequence (apt, Chocolatey, AdGuard DNS, reboot wait, ADWS wait,
  Windows static IP, router clone).
- Impact: deploy submission latency includes up to seven SSH round trips before
  the Ludus call. On a slow host this can exceed the user's patience and the
  request timeout budget.
- Proposed solution: (a) cache patch state per host/config hash so already
  applied patches are skipped without SSH; (b) run independent patches with
  bounded concurrency where the helper is idempotent; (c) return a clear
  "preparing host" phase to the client instead of a silent spinner.
- Expected benefit: removes most pre-deploy SSH time on warm hosts; keeps
  correctness for first deploy.

#### F-10: Log SSE polls Ludus and SSH every two seconds, sequentially

- Evidence: `src/app/api/logs/stream/route.ts:152-178` awaits range state then
  log cursor; `:215-255` awaits range state, GOAD log read, and Ansible log
  mtime; `:307` sleeps per poll; `:317` `cancel() {}` relies on
  `request.signal.aborted`.
- Impact: each open stream costs 2 Ludus calls + 2 SSH calls per 2 s per
  viewer. Sequential awaits lengthen the poll and delay cancellation.
- Proposed solution: parallelize independent reads per tick
  (`Promise.allSettled`), share one host log-tail cache across viewers, and
  make `cancel()` flip a flag checked before the next poll. Keep the SSE
  contract unchanged.
- Expected benefit: fewer overlapping streams, lower host load, faster
  cancellation.

#### F-11: Deploy log client duplicates SSE with 2 s history polling

- Evidence: `src/lib/logs/deploy-log-context.tsx:159-204` starts a 2 s
  `pullHistory` interval that fetches `/range/logs/history` and then detail +
  generations; `:229-235` ignores `[LUDUS]`/`[GOAD]` SSE lines while that timer
  is active.
- Impact: duplicate backend load and a pane that can lag the stream it is
  ignoring. The very lines the stream delivers are discarded.
- Proposed solution: choose one owner. Prefer SSE for live lines and use the
  history poll only as a fallback when the stream is disconnected or for
  initial backfill. Remove the `snapshotTimerRef` suppression once SSE is the
  owner.
- Expected benefit: halves log-related requests during deploy; removes
  duplicate/missing line behavior.

#### F-12: Testing page N+1 PB status queries and 3 s op poll

- Evidence: `src/app/testing/_testing.tsx:361-368` creates one query per
  accessible range; `:792` polls the selected op every 3 s; `:609-622` polls
  enrichment every 4.5 s while an op is active.
- Impact: a user with 20 shared ranges issues 20 status requests on page load,
  plus recurring polls.
- Proposed solution: add a bulk PB status endpoint that accepts multiple range
  IDs (or extend the existing bulk endpoint to include group-shared ranges),
  and drive dots from that single response. Keep per-range polling only for the
  selected range.
- Expected benefit: request count drops from O(ranges) to O(1).

#### F-13: Settings performance tab samples Proxmox over SSH every 4 s

- Evidence: `src/components/settings/ludus-performance-tab.tsx:18` `POLL_MS =
  4000`; `:108` `setInterval(fetchOnce, POLL_MS)`; `:124` states it samples via
  `pvesh` over host SSH.
- Impact: leaving the tab open costs an SSH `pvesh` call every 4 s. The chart
  keeps only 90 points, so older samples are discarded client-side.
- Proposed solution: pause polling when the tab is hidden
  (`document.visibilityState`), increase the interval to 10 s, and stop polling
  when the chart is not visible. Server-side caching can serve repeated
  samples.
- Expected benefit: 60% fewer SSH samples; no loss of visible resolution.

#### F-14: Global React Query policy causes refetch storms on focus

- Evidence: `src/lib/ui/query-client.ts:35-49`: `staleTime: 30_000`,
  `refetchOnWindowFocus: true`, retry twice on non-4xx.
- Impact: returning to a tab after 30 s refetches every mounted query at once,
  including expensive GOAD/admin queries. Retry doubles failed load.
- Proposed solution: keep `refetchOnWindowFocus` only for realtime queries;
  set it to `false` globally and opt in per query. Use `STALE` tiers per query
  and avoid retrying queries that are already polling.
- Expected benefit: fewer burst requests; smoother tab return.

#### F-15: `"use cache"` fetchers key on raw API keys

- Evidence: `src/lib/ludus/cached-ludus-fetch.ts:60-215` passes `apiKey` as a
  `"use cache"` argument; `:217-220` defines `ludusCachePartition` but
  `grep` shows no callers. `src/lib/ludus/ludus-cache-tags.ts:26-28` defines
  `ludusScopeCachePrefix` as `ludus:${scopeTag}:`, but actual tags are
  `ludus:${resource}:${scopeTag}` (`:16-17`, `:37-38`), and the helper has no
  callers either.
- Impact: the cache key includes the secret; key rotation or impersonation
  token changes bust every entry. The helper intended to prevent this is dead
  code, and the prefix helper would not match existing tags if used. Scope
  isolation still works because `scopeTag` is also an argument.
- Proposed solution: change the fetchers to accept a stable partition string
  (`ludusCachePartition(apiKey, scopeTag)`) and resolve the key inside, or
  keep the key out of the cache key by wrapping the cached function. Do not
  pass raw keys into `"use cache"`. Either fix or delete
  `ludusScopeCachePrefix`.
- Expected benefit: stable cache keys; fewer cold misses; matches documented
  guidance.

#### F-16: In-process SWR cache has no bound or eviction

- Evidence: `src/lib/core/server-cache.ts:26-31` stores entries in a `Map`;
  `:78-84` only deletes on explicit `invalidate`. TTL is checked on read but
  stale entries are never removed.
- Impact: every distinct range/API-key combination persists for the process
  lifetime. In a long-running container with many ranges/users this grows
  without limit.
- Proposed solution: add a maximum entry count with LRU eviction and a periodic
  sweep of expired entries. Keep the peek/get semantics.
- Expected benefit: bounded memory; predictable behavior after long uptime.

#### F-17: Range mutation invalidation is global

- Evidence: `src/lib/ludus/ludus-proxy-cache-invalidate.ts:20-29` revalidates
  `ludusGlobalRangeCacheTag(resource)` for every range resource; `:90` does the
  same for log enrichment. Comment at `:34` says "all effective scopes refresh
  on the next navigation". Range tags are not range-specific:
  `src/lib/ludus/ludus-cache-tags.ts:37-38` returns
  `ludus:${resource}:${scopeTag}`, so invalidating one range also invalidates
  every other range in that scope.
- Impact: one user's range mutation invalidates every scope's cached range
  data, causing a thundering herd on the next navigation. Global invalidation
  is defensible for ACL visibility, but the current blast radius includes
  unrelated ranges.
- Proposed solution: add the range ID to range-scoped tags, revalidate the
  acting scope/range tag, and keep a short global TTL for cross-user
  visibility. Reserve global invalidation for truly global resources
  (templates, users, groups).
- Expected benefit: fewer cross-user refetches; keeps impersonation isolation.

#### F-18: Admin slow path can fan out up to 30 range calls

- Evidence: `src/lib/admin/admin-data.ts:12` documents
  `GET /range/all + GET /user/all + up to 30× GET /range?rangeID=X`;
  `:191-201` issues up to 30 parallel per-range calls when the PocketBase fast
  path is unavailable. A 30 s `_swrCache` exists at `:40`, but a cold start
  still pays the fan-out.
- Impact: a cold admin page can issue dozens of parallel Ludus requests before
  rendering, which can saturate the API or hit rate limits.
- Proposed solution: prefer the bulk `/range/all` payload and join locally;
  cap concurrency and show partial data with a "loading more" indicator. Cache
  the joined result for 30 s.
- Expected benefit: bounded admin load; faster first paint.

### P2 — UX, responsive, and accessibility

#### F-19: VM table is unvirtualized and lacks accessible labels

- Evidence: `src/components/range/vm-table.tsx:447-508` renders a plain
  `<table>` and `sortedVms.map(...)` for every row; checkboxes at `:451-455`
  and row actions have no `aria-label`; destroy uses `window.confirm` per the
  checkpoint.
- Impact: ranges with hundreds of VMs produce a long task and heavy DOM;
  screen readers cannot identify row actions.
- Proposed solution: virtualize rows above a threshold (the log viewer already
  uses `@tanstack/react-virtual`), add `aria-label`/`scope` attributes, and
  replace `window.confirm` with the existing dialog primitive.
- Expected benefit: responsive scrolling at 200+ rows; accessible actions.

#### F-20: Shell layout clips wide content on narrow viewports

- Evidence: `src/components/layout/app-shell.tsx:90-104`: fixed `pl-16`/`pl-64`
  and `overflow-x-hidden` on the content wrapper.
- Impact: at 768×1024 and 390×844 the sidebar consumes 64 units and wide tables
  are clipped instead of scrolling. Target viewports are not supported.
- Proposed solution: collapse the sidebar to an overlay/drawer below `lg`,
  remove `overflow-x-hidden` from the content wrapper (or scope it to the
  page), and give tables an explicit `overflow-x-auto` container.
- Expected benefit: usable layout at all required widths.

#### F-21: Base dialog has no height cap or scroll region

- Evidence: `src/components/ui/dialog.tsx:36-39` sets `max-w-lg` but no
  `max-h`/`overflow-y-auto`; only some call sites add their own.
- Impact: tall dialogs (inventory, config, deploy details) overflow the
  viewport at 768×1024 and 390×844; the close button can leave the screen.
- Proposed solution: add `max-h-[calc(100dvh-2rem)]` and a scrollable body
  region in `DialogContent`, with the header/footer pinned.
- Expected benefit: every dialog is usable on small screens.

#### F-22: GOAD page uses a fixed 72-unit sidebar

- Evidence: `src/app/goad/_goad.tsx:581` `w-72 shrink-0`.
- Impact: at 1024×768 and below, the list plus content exceeds the viewport and
  the main pane is squeezed.
- Proposed solution: stack the list above the content below `lg`, or make it a
  collapsible drawer; keep the resizable split pane only on wide screens.
- Expected benefit: GOAD remains usable at 1024 and 768.

#### F-23: No loading skeletons and inconsistent busy states

- Evidence: `grep -rln "Skeleton" src` returns nothing; pages render empty
  tables or `null` while loading (e.g. `vm-table` has no loading branch).
- Impact: layout shift and ambiguous "is it empty or loading?" states,
  especially on cold prefetch misses.
- Proposed solution: add a minimal `Skeleton` primitive and use it for table
  rows and cards; reuse one pattern across pages.
- Expected benefit: perceived responsiveness; fewer false-empty impressions.

#### F-24: Deploy status changes are not announced

- Evidence: `src/app/_dashboard.tsx:1240-1254` badges and timestamps update
  without `aria-live`; log stream lines append without a live region.
- Impact: screen-reader users do not learn that a deploy started or finished.
- Proposed solution: add a polite `aria-live` region for range state and a
  separate one for terminal log errors; avoid announcing every log line.
- Expected benefit: accessible async feedback.

#### F-25: Responsive tables have no column priority

- Evidence: VM table (`src/components/range/vm-table.tsx:449-468`) always shows
  eight columns; the dashboard card does not hide secondary columns at narrow
  widths.
- Impact: horizontal scrolling or clipped data at 768 and 390.
- Proposed solution: hide IP/VMID/console columns below `md`, keep name/status/
  actions, and expose details in an expandable row.
- Expected benefit: readable table at target widths.

### P3 — maintainability and observability

#### F-26: No server-side timing or cache telemetry

- Evidence: `/api/proxy` and SSH routes return no `Server-Timing` header;
  `SWRCache` exposes no hit/miss counters; the perf spec only measures browser
  navigation and four buckets.
- Impact: regressions cannot be attributed to Ludus, SSH, SQLite, or render.
- Proposed solution: add `Server-Timing` with upstream/cache phases behind a
  debug flag, expose counters on `/api/health` or a metrics route, and extend
  the perf spec as in §4.4.
- Expected benefit: actionable diagnosis; measurable acceptance criteria.

## 6. React Query caching, hydration, and invalidation audit

### 6.1 What works

- Query keys include `effectiveScopeTag`, preserving impersonation isolation.
- Server prefetch uses `peek` (non-blocking) for L1 and dehydrates only cached
  values, so HTML delivery is not blocked on a cold cache.
- `"use cache"` tags include both global and scope tags, and mutation paths
  revalidate them.
- `retry` skips 4xx, avoiding pointless retries on auth/validation errors.

### 6.2 Defects

1. **Freshness is not represented in data.** The dashboard returns previous
   data without metadata (F-01). React Query's `dataUpdatedAt` then describes a
   successful update, not the underlying verification.
2. **Global invalidation is too broad** (F-17), and range tags do not include
   the range ID. This is a cache-stampede risk, not a correctness risk.
3. **Raw API key in cache args** (F-15) makes cache identity unstable and
   contradicts `ludusCachePartition`.
4. **Unbounded L1** (F-16) is a memory risk in long-lived containers.
5. **Focus refetch is global** (F-14), including polling queries, causing
   bursts.
6. **No stale-while-revalidate indicator.** L1 returns stale data immediately
   and revalidates in the background; the UI has no way to know it is stale.
   Add a `servedStale` flag to prefetch results and surface it.
7. **One authoritative store read through two paths.** PocketBase is Ludus's
   backend store and is authoritative for persisted range state; the dashboard
   reads the cached Ludus API view while testing reads PocketBase directly
   (F-05). Cache keys cannot fix that freshness difference.

### 6.3 Recommended cache policy

| Data class | Source of truth | Cache | Staleness display |
|---|---|---|---|
| Persisted range state (state, testing flag, VM count, domains) | PocketBase (Ludus backend) | L1 15 s, browser 15 s poll | spinner "Refreshing — last verified HH:MM:SS"; "Unavailable" after retries |
| Live VM inventory | Ludus `/range` | L1 15 s, browser 15 s poll | same active-refresh indicator; unconfirmed rows labeled |
| Deploy history | Ludus log history | 15–30 s | timestamp + refresh state |
| Log lines | SSE | no cache | live indicator / reconnect state |
| Templates/blueprints/ansible | Ludus | 60 s scoped tag | timestamp |
| Users/groups | Ludus | 60 s scoped tag | timestamp |
| Pending ops / test flags | PocketBase (Ludus backend) | short | reconcile with live range state |
| GOAD instances | SSH | 5–10 s in-process | "unavailable" on failure |

Stale data is retained only while an active refresh/reconnect is running. If
retries exhaust, the UI shows an unavailable state rather than presenting old
data as current. Do not use caching to mask a state transition; after a
mutating action the first refresh must be a verification read, not a cached
peek.

## 7. Ludus API vs SSH evaluation

| Operation | Current transport | API equivalent | Recommendation |
|---|---|---|---|
| Range status / VM list | Ludus API for live VMs; PocketBase for persisted state | Yes (`/range`, `/range/all`, PB collections) | Prefer PB for persisted state; Ludus for live VM inventory |
| Range config | Ludus API | Yes | Keep |
| Snapshots | Ludus API | Yes | Keep |
| Log history / cursor | Ludus API | Yes | Keep; share with SSE |
| Templates / blueprints / ansible | Ludus API | Yes | Keep |
| Users / groups | Ludus API | Yes | Keep |
| Deploy submission | Ludus API + host patches | Partial (API deploy exists; host prep does not) | Keep patches, cache/skip applied ones, parallelize |
| VM power / destroy | `pvesh` over SSH | Ludus API has VM actions but Proxmox-level ops need host | Keep SSH for admin/pvesh; prefer API where it covers the action |
| GOAD workspace list/ops | SSH + Python | No Ludus API equivalent | Keep SSH; add TTL cache and typed failure |
| GOAD log tail | SSH | No | Keep SSH; share tail cache |
| Host patch / Ansible home repair | lux-host SSH | No | Keep; make idempotent and cached |
| Settings performance samples | `pvesh` SSH | No | Keep; poll slower and pause when hidden |
| Persisted range state | Ludus API or PocketBase direct | Yes (PocketBase is the backend store) | Prefer PocketBase for persisted state; Ludus for live VM inventory |
| PocketBase status | Direct PocketBase HTTP | N/A (it is the store) | Authoritative for persisted range/user fields |

Principle: the API is preferred wherever it returns the same data. SSH remains
for host-only facts (Proxmox, GOAD workspace, playbook patches). Credentials
never reach the browser; all SSH stays server-side.

## 8. Large data and responsive UI

### 8.1 Large-data behavior

| Surface | Current behavior | Risk |
|---|---|---|
| VM table | all rows rendered | long tasks at 200+ VMs |
| Deploy history | paginated at 5 | fine, but polling adds rows |
| VM operation log | paginated at 5 | fine |
| App logs | capped at 2,000 lines | fine; virtualized above threshold |
| Deploy log | virtualized above threshold | fine; duplicate source is the issue |
| Admin shared VMs | serial discovery | slow at 20+ VMs |
| Testing dots | one request per range | O(ranges) load |

### 8.2 Target viewport matrix

| Target | Current risk | Fix |
|---|---|---|
| 1920×1080 | none | — |
| 1440×900 | none | — |
| 1366×768 | VM table columns tight | hide secondary columns below `md` |
| 1024×768 | GOAD `w-72` + content | stack/drawer below `lg` |
| 768×1024 | fixed `pl-64`, clipped tables | overlay sidebar, table scroll |
| 390×844 | clipped shell, tall dialogs | overlay sidebar, dialog max-height |
| 360×800 | same as 390 | same |

## 9. Top-10 ranked improvements

Ranking weighs correctness first, then interaction latency, then backend cost,
then UX. Effort is relative (S < 1 day, M 1–3 days, L > 3 days). Risk is the
chance of regressing behavior without tests.

| Rank | Improvement | Findings | Impact | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Add active refresh/unavailable state to range queries and render it; stop relabeling 400 as fresh | F-01, F-03 | Removes misleading state; no extra load | S | Low |
| 2 | Add explicit `loading/error/empty/ready` states to VM table and other data surfaces | F-03, F-23 | Prevents false-empty and unnecessary deploys | S | Low |
| 3 | Bound VM union merge and mark unconfirmed rows | F-02 | Removes phantom VMs | S–M | Medium |
| 4 | Fix sources error classification | F-04 | Correct diagnosis | S | Low |
| 5 | Cache GOAD instance listing with TTL + typed failure result | F-06, F-07 | Removes SSH from every GOAD request | M | Medium |
| 6 | Remove duplicate deploy-log polling; make SSE the single owner | F-10, F-11 | Halves log requests; fixes ignored lines | M | Medium |
| 7 | Parallelize/cached host patches and admin shared-VM discovery | F-08, F-09 | Cuts deploy/admin latency | M | Medium |
| 8 | Bulk testing PB status; poll only selected range | F-12 | O(ranges) → O(1) requests | M | Low |
| 9 | Tighten cache policy: range-scoped invalidation, hashed partition keys, bounded L1, opt-in focus refetch | F-14–F-18 | Fewer stampedes; stable keys; bounded memory | M | Medium |
| 10 | Responsive shell, dialog scroll, table virtualization/column priority | F-19–F-22, F-25 | Meets target viewports; large tables usable | L | Medium |

### Proposed implementation sequence

Phase 2A — correctness and observability (small, independent):

1. F-01/F-03 active-refresh + state model.
2. F-05 PocketBase as the persisted-state read on the dashboard.
3. F-04 sources classification.
4. F-06 typed GOAD failure.
5. F-02 merge bound.
6. F-26 `Server-Timing` and perf-spec extension.

Phase 2B — hot paths:

7. F-07 GOAD cache.
8. F-10/F-11 log single-owner.
9. F-08/F-09 concurrency and patch cache.
10. F-12 bulk status.

Phase 2C — cache:

11. F-15 hashed partition.
12. F-16 bounded L1.
13. F-17 range-scoped invalidation.
14. F-14 focus policy.

Phase 2D — UI:

15. F-19/F-25 table.
16. F-20/F-21/F-22 shell/dialog/GOAD.
17. F-23/F-24 skeletons and live regions.

Each phase should be validated with `npm run test:unit`, the relevant E2E
flows, and the perf harness before/after. No phase should weaken existing
tests.

## 10. Confirmed decisions and Phase 2 readiness

1. **PocketBase is Ludus's backend data store.** Confirmed against
   <https://docs.ludus.cloud/docs/administration/pocketbase> and
   `src/lib/core/pocketbase-client.ts`. PocketBase is authoritative for
   persisted range/user fields (`rangeState`, `testingEnabled`,
   `numberOfVMs`, allowed domains); Ludus `/range` remains the source for live
   VM inventory. F-05 has been revised accordingly. Phase 2 should use
   PocketBase consistently for persisted state instead of treating it as
   LUX-owned metadata.
2. **Stale-data policy.** Confirmed: prefer fresh data. Retain verified data
   only during an active refresh/reconnect caused by network loss or an
   unreachable host, and show that activity in the UI. When retries exhaust,
   show an unavailable state with the last verified timestamp. F-01/F-02 have
   been revised accordingly.
3. **GOAD cache TTL.** Accepted: 5–10 s in-process cache, invalidated on GOAD
   mutations, with a typed unavailable result (F-06/F-07).
4. **Host patch caching.** Confirmed, provided functionality is unchanged.
   Cache per host/config hash only after a patch is verified applied; keep all
   seven patches and their idempotent behavior.
5. **Log ownership.** Confirmed: SSE owns live lines; history polling is a
   fallback for initial backfill and reconnects only (F-10/F-11).
6. **Baseline environment.** Deployed v1.6.0 at `https://10.8.0.176`
   (`adminuser`) was measured on 2026-11-12. Results are in §4.5 and
   [`perf-baseline-v1.6.0.json`](perf-baseline-v1.6.0.json). p50/p95 and the
   additional interaction metrics still require the Phase 2 instrumentation in
   §4.4.

Phase 2 can start with Phase 2A. The only open sequencing choice is whether the
dashboard should switch persisted-state reads to PocketBase in Phase 2A
(correctness) or Phase 2C (data model); the recommendation is Phase 2A because
it removes the cached-Ludus/400 path that causes the stale-as-fresh behavior.

## 11. Phase 2A implementation notes

Implemented in this worktree:

- F-01/F-03 — dashboard range refresh now carries `lastVerifiedAt`,
  `refreshState`, and `lastError`. HTTP 400/network/5xx failures are retried
  with a bounded retry budget; stale rows are shown only while a retry is
  active. After retries exhaust, the card and VM table show unavailable/error
  with the last verified timestamp and a retry action. Auth failures hide
  stale rows, and the stat cards report "Unavailable" rather than a fabricated
  "NEVER DEPLOYED" or zero VM count.
- F-02 — `resolveVmListForRangeQuery` returns `{ vms, unconfirmedVmKeys,
  merged }`. Merges are capped at two polls, including alternating short
  snapshots and DEPLOYING/WAITING gaps. Retained rows are marked unconfirmed
  in the VM table.
- F-04 — sources loading, load failure, and the unsupported-version case are
  distinct; a load failure offers retry instead of the upgrade notice.
- F-05 — the dashboard reads persisted range fields from PocketBase via
  `/api/range/pb-status` and keeps Ludus `/range` for live VM inventory. The
  route reports `X-LUX-Range-State-Source`, and the state badge names the
  source.
- F-06 — `listGoadInstancesResult` distinguishes an empty workspace list from
  a transport/parse failure. `/api/goad/instances` returns the failure instead
  of an empty list.
- F-26 — `/api/proxy` emits `Server-Timing` with auth, admin, body, preflight,
  upstream, and total phases; the perf harness records p50/p95 and parses the
  header. A local probe with an unreachable Ludus host showed the admin-liveness
  check alone can consume one full upstream timeout, which the `admin` phase now
  makes visible.
- Dashboard host metrics — `/api/host-resources` now serves a process-level
  snapshot cache and revalidates over SSH in the background. Dashboard SSR
  prefetches the cached snapshot into the React Query cache, so reloads render
  last-known CPU/memory with `capturedAt` instead of waiting on SSH behind
  "Reading CPU and memory…". The card labels refreshing, stale, failed, and
  unavailable data with the last verified time; a failed read backs off before
  the next attempt and only keeps the previous snapshot while a refresh is
  active or the sample is recent.

Validation: unit tests for the new helpers and the merge bound pass;
`tsc --noEmit` passes; `next build --webpack` succeeds. The full unit suite has
two pre-existing environment failures in `lux-upgrade-host.test.ts` (systemd
timing and a git clone path) unrelated to these changes.

## 12. Phase 2B implementation notes

Implemented in this worktree:

- F-07 — `listGoadInstancesResult` caches a successful workspace listing for
  7 s in a bounded process cache keyed by host, port, SSH user, and `goadPath`.
  Failures are not cached. Ownership/range writes, extension edits, workspace
  refreshes, network/IP syncs, and reassignment clear the entry.
- F-08 — `/api/admin/shared-vms` resolves `/nodes` once, runs status and guest
  agent reads with a four-worker pool, and caches the result for 10 s.
  `?refresh=1` bypasses the cache for the explicit refresh button.
- F-09 — Host playbook patches cache a verified `ok` result for 10 minutes per
  host/account/operation and bundled-helper checksum; failures retry. The seven
  patches and the Ansible speedups drop-in run with a three-worker pool, and
  concurrent helper installs share one `ensureLuxHostCurrent` sync.
- F-10/F-11 — The SSE route reads the Ludus log, range state, and host clock in
  parallel, shares one 2 s GOAD log-tail read across viewers, and aborts the
  poll delay on cancel. The deploy-log client no longer runs its duplicate 2 s
  history poll; SSE is the single owner of live lines.
- F-12 — `/api/range/pb-status?rangeIds=…` answers selector dots with one
  PocketBase OR-filtered query (full-scan fallback), filling missing IDs from a
  single Ludus `/range` call. `enrichRangesWithPbRecords` uses the same bulk
  query instead of one request per range. The testing page drives dots from the
  bulk response.

Validation: new unit tests cover the TTL cache, concurrency helper, and GOAD
tail cache; targeted suites, `tsc --noEmit`, and ESLint pass.

## 13. Phase 2C implementation notes

Implemented in this worktree:

- F-15 — `"use cache"` fetchers no longer receive raw API keys. Public wrappers
  register the key in a bounded process registry and pass a stable
  `scopeTag:sha256(apiKey)` partition; the cached body resolves the key from the
  registry. Impersonation key rotation therefore stops creating new cache
  entries, and no key material appears in cache keys.
- F-16 — `SWRCache` now enforces a 256-entry bound with LRU eviction, touches
  entries on read, and periodically drops entries that stayed stale far past
  their TTL. `TtlCache` keeps its own bound. Scope/range keys can no longer grow
  the in-process map without limit.
- F-17 — Range cache tags include the range ID
  (`ludus:<resource>:<scope>:<rangeId>`) alongside the scope-wide tag. A proxy
  mutation with a known `rangeID` (query or body) revalidates only that range in
  the acting scope; without one it falls back to the scope-wide tags. Global
  tags remain for ACL-wide catalog resources (users, groups, templates,
  blueprints, ansible), whose mutations are rare and cross-scope.
- F-14 — `refetchOnWindowFocus` defaults to `false`. Dashboard range status,
  host metrics, testing range status, the range list, builder status, and the
  groups range dialogs opt in; returning to a tab no longer refetches every
  mounted ACL, catalog, and admin query at once.

Validation: unit tests cover the bounded SWR cache, range-scoped invalidation
tags, and the partition helper; targeted suites, `tsc --noEmit`, ESLint, and
`next build --webpack` pass.

## 14. Phase 2D implementation notes

Implemented in this worktree:

- F-19/F-25 — The VM table renders flex rows with role/aria labels, hides IP,
  VMID, and console columns below `md`, and windows the list above 100 rows
  (`@tanstack/react-virtual`, 22 rows rendered at 120 VMs in the browser check).
  Destroy now opens the shared dialog with a Cancel/Destroy pair instead of
  `window.confirm`. Loading renders skeleton rows, and the range card stays in
  place while the first status poll runs so a cold load is not a blank page.
- F-20 — Below `lg` the sidebar is an off-canvas drawer opened from the header
  hamburger, closed by Escape, the overlay, or navigation. The content wrapper
  no longer sets `overflow-x-hidden`; pages scroll horizontally only where a
  table needs it. At 390×844 the document width stays at 390 px.
- F-21/F-22 — `DialogContent` is capped at `calc(100dvh - 2rem)` with vertical
  scroll, and the GOAD instance page stacks its operations column below the
  main column under `lg` instead of forcing a 288 px sidebar.
- F-23/F-24 — The dashboard announces range state and refresh transitions in a
  polite live region, dashboard errors in an alert region, and the terminal log
  viewer announces the latest `[ERROR]` line instead of every appended line.
  Loading placeholders use the new `Skeleton` primitive.

Validation: browser checks at 390×844 and 1280×800 covered drawer open/close,
column hiding, virtualization and scroll-to-last, the destroy dialog, and the
skeleton-to-data transition with mocked Ludus responses; `tsc --noEmit`, ESLint,
the unit suite, and `next build --webpack` pass.

## 15. Phase 3 implementation notes

Implemented in this worktree:

- F-13 — The settings performance tab polls every 10 s and only while the
  document is visible. A `visibilitychange` listener stops the timer when the
  tab is hidden and takes an immediate sample when it becomes visible again.
  The route serves an 8 s process-cached sample and returns the original
  `capturedAt`, so staggered admin tabs share one SSH `pvesh` read and an old
  sample is never relabeled as fresh. Cache misses wait for a fresh read;
  failures are not cached.
- F-18 — The admin slow path joins `/range/all` and `/user/all` locally before
  issuing detail lookups, so only ranges still unowned after the SQLite,
  embedded-userID, primary-range, and default-range rules are fetched. Detail
  lookups remain capped at 30 and now run with six workers. Failed or skipped
  lookups are returned as `partial.unresolvedRangeIDs` (with `truncated` when
  the cap was reached); the admin page shows a partial-data notice with a Retry
  button that bypasses the 30 s server cache.

Validation: unit tests cover the bounded slow-path fan-out, partial ownership
reporting, the node-metric cache outcome, and the host-resource cache status.
`tsc --noEmit`, ESLint, and `next build --webpack` pass.

## 16. Phase 4 implementation notes

Implemented in this worktree:

- F-26 — SSH-backed routes emit `Server-Timing`:
  `/api/settings/proxmox-node-metrics` (auth, cache, ssh, total),
  `/api/goad/instances` and `/api/goad/by-range` (auth, ssh, upstream, total),
  `/api/admin/shared-vms` (auth, cache, ssh, total),
  `/api/host-resources` (auth, cache, ssh, total), and
  `/api/admin/ranges-data` (auth, data, total). Cache phases carry a
  `desc=hit|miss|stale|shared` descriptor where the route knows the outcome.
  `LUX_SERVER_TIMING=0` disables the header.
- Cache telemetry — `TtlCache`, `SWRCache`, and the host-resources cache record
  hit/miss/stale/shared counters in a process-local registry exposed at
  `/api/metrics`. The route is public and reports only counters, uptime, and
  version, never keys or user data.
- `e2e/perf-pages.spec.ts` iterates a fixed route list and records per route:
  navigation timing, API request counts and status distribution, p50/p95 per
  API path, `Server-Timing` phases, and API requests issued after the page is
  visibly loaded. It attaches `perf-pages.json`; `npm run test:perf:pages` runs
  it, while `npm run test:perf` remains the refresh regression guard.

## Appendix A — Request-cost map (code-derived)

| Path | Backend calls per request | Notes |
|---|---|---|
| `/api/proxy/ranges/accessible` | 1 Ludus | cached 30 s |
| `/api/proxy/range` | 1 Ludus | dashboard polls 15 s |
| `/api/proxy/range/logs/history` | 1 Ludus | cached 30 s, also polled 2 s by log UI |
| `/api/proxy/version` | 1 Ludus | cached 300 s |
| `/api/logs/stream` | 2 Ludus + 2 SSH per 2 s | shared GOAD tail; parallel reads |
| `/api/goad/instances` | 1 SSH + Python | cached 7 s |
| `/api/goad/by-range` | 1 SSH + 1 Ludus | cached 7 s |
| `/api/goad/instances/*` | 1 SSH access check + op | cached 7 s |
| `/api/admin/shared-vms` | 1 + 2×VMs SSH | cached 10 s; bounded parallel |
| `/api/range/pb-status` | 1 PocketBase query (Ludus fallback) | bulk `rangeIds` = 1 query |
| `/api/settings` (performance tab) | 1 SSH `pvesh` per 10 s | while visible; cached 8 s; pauses when hidden |
| `/api/host-resources` | 1 SSH `pvesh` per ~15 s (background) | dashboard polls 10 s; served from cache; `Server-Timing` auth/cache/ssh |
| `/api/metrics` | 0 backend calls | process-local cache counters; public |

## Appendix B — Files reviewed

- `src/proxy.ts`, `src/app/layout.tsx`, `src/components/layout/*`
- `src/app/_dashboard.tsx`, `src/app/testing/_testing.tsx`,
  `src/app/sources/_sources.tsx`, `src/app/goad/_goad.tsx`,
  `src/app/goad/[id]/goad-instance/*`
- `src/app/api/proxy/[[...path]]/route.ts`, `src/app/api/logs/stream/route.ts`,
  `src/app/api/goad/**`, `src/app/api/admin/**`,
  `src/app/api/range/pb-status/route.ts`, `src/app/api/sources/route.ts`
- `src/lib/core/server-prefetch.ts`, `src/lib/core/server-cache.ts`,
  `src/lib/ludus/cached-ludus-fetch.ts`,
  `src/lib/ludus/ludus-cache-revalidate.ts`,
  `src/lib/ludus/ludus-proxy-cache-invalidate.ts`,
  `src/lib/ludus/ludus-swr-invalidate.ts`,
  `src/lib/goad/goad-ssh.ts`,
  `src/lib/goad/fetch-goad-instances-for-request.ts`,
  `src/lib/range/range-deploy-host-patches.ts`,
  `src/lib/logs/deploy-log-context.tsx`,
  `src/lib/ui/query-client.ts`, `src/lib/ui/query-keys.ts`,
  `src/lib/ui/dashboard-vm-merge.ts`
- `src/components/range/vm-table.tsx`, `src/components/ui/dialog.tsx`,
  `src/components/settings/ludus-performance-tab.tsx`
- `e2e/perf-refresh.spec.ts`, `e2e/scripts/compare-perf.mjs`,
  `config/next.config.cjs`, `package.json`
