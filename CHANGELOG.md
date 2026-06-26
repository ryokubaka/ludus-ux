# Changelog

All notable changes to Ludus UX (LUX) will be documented in this file.

Each bullet uses a single tag:

- **[Add]** — New capability
- **[Fix]** — Bug or wrong behavior
- **[Improve]** — UX polish or refactor without a new feature
- **[Perf]** — Performance improvement
- **[Security]** — Security fix
- **[Docs]** — Documentation improvement
- **[Remove]** — Removed capability
- **[Breaking]** — Breaking change

---

## [1.1.4] - 2026-06-22

**LUX**
- [Add] **Deploy New GOAD Instance** — Review step shows generated Ludus `provider/config.yml` preview in an editable YAML editor; custom config is injected at deploy via Ludus CLI wrapper.
- [Add] **Deploy New GOAD Instance** — Ansible role/collection dependency checks with inline install on Review; extension checkboxes gated when required roles are missing (same pattern as template readiness).
- [Add] **GOAD instance Extensions tab** — Gate extension install on missing Ansible roles; **Install dependencies** inline; refresh catalog on instance load for `requiredRoles`.
- [Improve] **Deploy New Range (wizard)** — Review step uses inline Monaco YAML editor (editable generated config, reset/reload, validation) like the GOAD wizard.

## [1.1.3] - 2026-06-22

**LUX**
- [Add] **Configuration** — Deploy Host Limit panel on Range Configuration: checkbox host picker (config YAML + sync deployed VMs), maps to Ludus CLI `--limit` / `POST /range/deploy` `limit`; combinable with deploy tags.

## [1.1.2] - 2026-06-16

**LUX**
- [Fix] **Auth** — Sign out then sign in as another user no longer keeps prior username, badge, or role nav; logout clears client caches and uses full reload; login reloads layout with fresh session.
- [Fix] **Configuration / Deploy New Range / GOAD** — Deploy tag checkboxes now toggle correctly when clicking the checkbox itself (removed double-toggle from parent click + `onCheckedChange`).
- [Fix] **Range Logs** — Auto-scroll toolbar button no longer disappears on full page refresh; stream start waits for range selection and abort races no longer leave `isStreaming` stuck false.
- [Fix] **Testing Mode** — Same auto-scroll toolbar visibility fix as Range Logs.
- [Fix] **Sidebar** — Addressed issue where multiple nav items highlighted (e.g. Ludus Performance no longer also highlights Ranges Overview).
- [Add] **Blueprints** — Pencil edit on owned blueprints (Monaco YAML editor); source/global installs stay read-only — duplicate first to get an editable copy you own.
- [Add] **Sources** — New `/sources` page to register, sync, delete (with optional purge), and browse catalog status from Ludus 2.2.0 Sources API; feature-gated when server lacks Sources. Sources nav hidden unless connected Ludus is 2.2.0+ (page still reachable by URL).
- [Add] **Ansible Galaxy** — Search galaxy.ansible.com and install roles/collections from the UI; results group versions per artifact with expandable list (newest first).
- [Improve] **Templates / Blueprints** — Add-from-source catalog prefers Ludus-native listing (description, `min_ludus_version`) when Sources API is available; GitHub/GitLab tree fallback unchanged.
- [Improve] **Templates** — Source catalog distinguishes **Added** (on Ludus, not built) vs **Built**; main list uses same labels.
- [Improve] **Templates** — Build History moved below Add from Source.
- [Improve] **Templates** — Starting a build auto-scrolls to live Packer logs.
- [Improve] **Templates / Blueprints / Ansible** — Add-from-source defaults to registered Ludus sources with auto-fetch; GitHub/custom repo still available.
- [Improve] **UI** — Expandable section headers vertically centered (previously slightly off-center).

## [1.1.1] - 2026-06-15

**LUX**
- [Fix] **Testing Mode** — Start/stop no longer stuck on "Starting…" when ansible finished but Ludus/PocketBase lagged: SSH-first op-scoped log slice (2 MB), capped-length slicing before tail-anchor (avoids false matches on repeated ansible output), POST completion retries after PUT returns, and awaited PocketBase `testingEnabled` sync with backoff before the op is marked complete.
- [Fix] **Templates** — Official add-from-source catalog now pulls from GitHub [`badsectorlabs/ludus-source-bsl`](https://github.com/badsectorlabs/ludus-source-bsl) (replacing the retired GitLab `badsectorlabs/ludus` repo); shared `template-repo-client` handles GitLab and GitHub tree/raw APIs for list and add flows.
- [Add] **Blueprints** — Add from Source installs from [`badsectorlabs/ludus-source-bsl/blueprints`](https://github.com/badsectorlabs/ludus-source-bsl/tree/main/blueprints) via Ludus Sources when available, else `POST /blueprints` / from-range config upload from fetched YAML.
- [Add] **Deploy New Range** — Config method **From Blueprint** applies an installed or source blueprint then deploys.
- [Add] **Blueprints** — Apply dialog and range wizard **From Blueprint** check Ansible roles/collections against `GET /ansible`, list missing deps, and offer **Install dependencies** (`POST /blueprints/{id}/install` with per-item fallback).

## [1.1.0] - 2026-06-09

**LUX**
- [Add] **Next.js 16** — Upgraded to Next 16.2.7 and React 19; enabled `cacheComponents` with `AuthenticatedRoot` Suspense boundary and server-side LUX version cache on Settings.
- [Add] **SSR prefetch** — TanStack `HydrationBoundary` + non-blocking server prefetch on Users, Templates, Groups, Blueprints, Ansible, Dashboard, Logs, Snapshots, Testing, and Range Config pages (accessible ranges and version still prefetched globally in the root layout).
- [Add] **Selected range cookie** — httpOnly `__Host-lux_selected_range` mirrors sidebar selection (scope-tagged) via `POST /api/session/selected-range` so range-scoped pages can prefetch the correct range on first paint.
- [Add] **Ludus data cache** — `"use cache"` L2 layer (`cached-ludus-fetch.ts`) behind in-process SWR peek; `revalidateTag(tag, 'max')` invalidation on admin/range mutations and Ludus proxy writes (`ludus-cache-revalidate.ts`, `ludus-proxy-cache-invalidate.ts`).
- [Add] **Impersonation verify script** — `scripts/verify-impersonation-ssh.mjs` ships in the Docker image for live bashrc API-key reads (no manual UI retest).
- [Add] **LogViewer compound API** — `LogViewerCompound.Root|Toolbar|Search|Body` for composable log panes; adopted on Dashboard, Range Logs, Admin → Application Logs, Templates, Testing, and Range Config.
- [Add] **E2E** — GOAD task ACL unauthenticated (`e2e/goad-task-acl.spec.ts`); deploy tab smoke (`e2e/goad-instance-deploy.spec.ts`); Extensions/History tabs with auth (`e2e/goad-instance-tabs.spec.ts`).
- [Add] **Tests** — Unit coverage for bashrc API-key parsing, selected-range cookie resolution, Ludus group list parsing, snapshots view grouping, and Ludus proxy cache invalidation (112 tests).
- [Improve] **GOAD instance page** — Six typed tab modules (`goad-instance-tabs/*`), shell components (header, action bar, reassign dialog, tab triggers), and action hooks (`use-goad-run-action`, `use-goad-instance-action-handlers`); orchestrator ~1.2k lines (down from ~2.8k).
- [Improve] **Next 16 proxy** — Renamed `middleware.ts` → `proxy.ts` and `middleware()` → `proxy()` per Next 16 network-boundary convention (auth gate + security headers unchanged).
- [Improve] **Cache Components hygiene** — `markRouteDynamic()` in `getLayoutSession` and `requireAdminPage` before cookie reads under `cacheComponents`; `cached-lux-version` uses stable `cacheLife` import.
- [Improve] **Shared parsers** — `parseLudusGroupList`, `buildSnapshotsViewData`, and `NetworkSnapshot` type for Ludus list/YAML/network handling.
- [Improve] **Impersonation UX** — Toast surfaces server `message` when auto-fetch of `~/.bashrc` API key fails; range cookie cleared on impersonate start/stop and logout.
- [Perf] **Cold-start SSR** — Warm Ludus cache entries shared across Next workers; proxy mutations bust groups/blueprints/templates/ansible/ranges tags so the next navigation reflects Ludus writes without a hard refresh.
- [Fix] **CI lint** — Scoped npm `brace-expansion` override to `@eslint/config-array` so `npm run lint` no longer hits ESLint 9 circular-config validation on GitHub Actions.

---

## [1.0.7] - 2026-06-08

**LUX**
- [Security] **GOAD task API** — GET no longer returns `ludusApiKey` or log `lines`; list and detail share a public DTO. PATCH `/api/goad/tasks/[taskId]` and POST `link-instance` enforce task ownership (same as GET/stop/stream).
- [Security] **GOAD task secrets** — `goad_tasks.ludus_api_key` encrypted at rest in SQLite (migration v14).
- [Security] **Session vault** — API key, SSH password, and impersonation key moved server-side; cookie holds opaque `sessionId` only (migration v15). Edge middleware uses a SQLite-free session layer so the app stays healthy behind nginx.
- [Security] **Login** — Step two uses a one-time server continuation token so the SSH password is not re-sent from the browser; login blocked over plain HTTP in production. TLS/certificate failures surface as connection errors instead of a false “stale ~/.bashrc API key” prompt.
- [Security] **Admin gate** — Admin mutations re-validate `isAdmin` against Ludus live; impersonation POST validates `apiKey` matches the principal.
- [Security] **Deploy log SSE** — Errors sanitized via `safeClientError` in production.
- [Improve] **Settings secrets** — PBKDF2 (`enc:v2:`) with backward-compatible `enc:v1:` decrypt.
- [Perf] **Deploy log SSE** — Adaptive poll backoff (2s → 5s → 10s when idle); optional `LOG_STREAM_MAX_MS` cap.
- [Perf] **Range list** — Polling slows to 60s when the browser tab is hidden.
- [Improve] **`/api/logo`** — Public for favicon; `global-error.tsx` root fallback added.
- [Fix] **GOAD reconcile logs** — `/range/logs` no longer retries with `LUDUS_ROOT_API_KEY` when the task owner's Ludus user API key is set; empty HTTP body during deploy uses SSH `ansible.log` instead of spurious root-key 401 warnings.
- [Fix] **Admin impersonation** — `setSessionCookie` no longer re-writes vault secrets into the cookie (which wiped `impersonationApiKey` on the next request); proxy and prefetch again scope Ludus calls to the impersonated user.
- [Fix] **Users → WireGuard** — Admin download for another user reads their `LUDUS_API_KEY` from `~/.bashrc` and calls Ludus as them (`GET /api/admin/user-wireguard`); Ludus `/user/wireguard` is scoped to the caller's API key, not `X-Impersonate-User`.
- [Improve] **Build** — ESLint runs during production builds (`eslint.ignoreDuringBuilds: false`).
- [Add] **Tests** — Unit coverage for GOAD ACL DTO, `requireAdmin`, session vault, and at-rest encryption; Playwright smoke for GOAD task ACL, auth gates, login UI, and public health/logo routes.
- [Docs] **Architecture & environment** — Session vault, TLS policy, and single-instance constraints documented.

---

## [1.0.6] - 2026-06-04

**LUX**
- [Fix] **GOAD deploy (overwrite existing range)** — Wait for Ludus VM destroy to finish before starting GOAD so dynamic inventory does not fail mid-teardown (stuck deploy after VM wipe).
- [Fix] **GOAD deploy (overwrite existing range)** — Regenerate workspace `config.yml` and inventory files before Provide/Install when reusing an existing GOAD instance (`update_instance_files` REPL + `refresh-workspace` API to sync `instance.json` extensions).
- [Fix] **GOAD deploy logs** — Pass `instanceId` into execute, `?goadTaskId=` on redirect, and retry task resume on the instance page so the GOAD log panel streams without a manual refresh.

---

## [1.0.5] — 2026-06-02

**LUX**
- [Add] **Admin → Application Logs** — Admin Application Logs page with live streaming of sign-in and application events. Ludus proxy and LUX API routes log user actions so the Application filter is populated, not only auth events.
- [Add] Structured application event logging for settings, impersonation, user roles, ranges, and GOAD.
- [Fix] Settings admin controls respect current Ludus admin role (live revalidation on session refresh).
- [Fix] **Testing Mode** — PocketBase `testingEnabled` reconciles when Ludus/ansible finishes (op-scoped, log slice after op start) so UI matches backend state.
- [Fix] **Testing Mode** — Op completion follows op-scoped ansible logs first; PocketBase sync is best-effort only. Removed passive pb-status reconcile that could fight in-flight ops and flip `testingEnabled` wrong.
- [Fix] **Testing Mode** — Log markers persisted in SQLite so op completion survives container restart; full-tail fallback when marker missing.
- [Fix] **Range Logs** — History timestamps anchor to ansible.log mtime on Ludus host instead of browser refresh time.
- [Improve] **Testing Mode** — Range selection locked on the Testing page and sidebar Active Range dropdown while start/stop is in progress.
- [Improve] Ludus Performance moved from Settings to Admin → Performance.
- [Security] Shorter session lifetime (eight hours).
- [Security] Login rate limiting to slow down password guessing (one-minute lockout after too many attempts).
- [Security] Stronger upload checks for profile images and the site logo (10 MB logo limit).
- [Security] Safer error pages and API responses in production.
- [Security] Improved web server and TLS settings behind nginx.
- [Security] Console connections use single-use access tokens.
- [Security] Sign-in and sign-out events are written to the application log.
- [Security] **vitest** 4.1.8 — patches GHSA-5xrq-8626-4rwp / CVE-2026-47429

---

## [1.0.4] — 2026-05-28

**LUX**
- [Fix] **Testing Mode** — Start/stop progress labels (button, log panel, alerts) follow PocketBase `testingEnabled` instead of the DB op record, so stopping testing no longer briefly shows "Starting Testing Mode…" while Ludus is still processing.
- [Fix] **Settings → Ludus Performance** — CPU chart reads utilization from Proxmox `pvesh get /cluster/resources` (pvestatd) instead of `/nodes/{node}/status`, which often reported 0% on independent polls.
- [Add] **Settings → About → Release notes** — Keyword search and quick filters by tag (Add, Fix, Enhance, …) across version titles, groups (LUX/GOAD), and descriptions, with match counts, auto-expanded hits, and highlighted terms.
- [Improve] **CHANGELOG** — Retired generic `[Change]` tag; all historical bullets recategorized (see [tag guide](https://github.com/ryokubaka/ludus-ux/blob/main/CHANGELOG.md)).
- [Improve] **Ranges Overview** — Hide the **ROOT** user row from Users & Ranges; ROOT is admin-only and not a Ludus utilization user.
- [Docs] **Templates** — New [docs/templates.md](docs/templates.md): how the Templates page works (build, add-from-source, logs), Proxmox permissions for `iso_download_pve`, and troubleshooting `403 Permission check failed` when `AccessNetwork` ACL is on the wrong node (e.g. `/nodes/127.0.0.1` vs `proxmox_node`).

---

## [1.0.3] — 2026-05-26

**LUX**
- [Improve] **Dashboard → VM power** — Per-VM and bulk power on/off stay in a pending/spinning state until Ludus confirms each VM is running or stopped; status shows **Starting…** / **Stopping…**; **All On** / **All Off** spin until every targeted VM confirms (slow Ludus timeouts still poll for confirmation).
- [Fix] **Post-GOAD firewall redeploy banner** — Step 2 no longer sticks after **Deploy Tags: network** succeeds; empty-template Ludus history rows now match in terminal state (not only while `running`), GOAD tasks poll while `phase=network-deploy`, and the dashboard clears stale phase when history already shows completion.
- [Security] **ws** 8.21.0 — patches GHSA-58qx-3vcg-4xpx / CVE-2026-45736; **brace-expansion** 5.0.6+ override — patches GHSA-jxxr-4gwj-5jf2 / CVE-2026-45149.

---

## [1.0.2] — 2026-05-22

**LUX**
- [Fix] **GOAD instance → Extensions tab** — Long extension lists scroll inside the tab panel again (scrollbar visible); same layout fix for **Lab Info** and **Inventories** tabs when content exceeds the viewport.
- [Improve] **GOAD extensions (no new VMs)** — Extensions with no Ludus machines show **Provision** instead of **Install** and confirm Ansible-only enablement (no range deploy). Feature requires modification to GOAD (see [goad-mod](https://github.com/ryokubaka/goad-mod)). Normal GOAD will execute `ludus range deploy` even for a zero-VM extension.

---

## [1.0.1] — 2026-05-14

**LUX**
- [Add] **Quickstart** — `scripts/quickstart.sh` supports **`--full`**, **`--menu`**, and an in-script choice of a lighter **menu** versus the **full wizard** again.
- [Add] **Quickstart** — During interactive setup, the script can install **`sudo`** on the Ludus/Proxmox SSH target where minimal Debian-style installs omit it
- [Improve] **Quickstart** — Publishes your **`SSH_KEY_PATH`/`id_rsa`** public half to the Ludus server to address SSH key only based authentication 
- [Fix] **Range creation `userID`** — Client `ludusApi.createRange` resolves the caller’s Ludus `userID` instead of incorrect `name`
- [Fix] **Admin impersonation** — “Manage as” stores **`userID`**, **`name`**, and **SSH login** separately so Ludus range APIs see the real **`userID`**, SSH/GOAD still use **`proxmoxUsername`** (`name` fallback), instead of collapsing everything into **`name`** and breaking impersonated workflows
- [Fix] **Settings merge** — Empty `proxmoxSshPassword` / `proxmoxSshUser` values stored in SQLite no longer override `PROXMOX_SSH_*` from the environment (same idea as the root API key), so `.env` Proxmox SSH credentials are not masked after a Settings save with blank fields.
- [Fix] **Ranges Overview → shared services (ADMIN pool)** — `/api/admin/shared-vms` and `/api/admin/vm` now authenticate to Proxmox only with configured root SSH: `PROXMOX_SSH_USER`, `PROXMOX_SSH_PASSWORD`, and/or the mounted private key. They no longer reuse the browser session’s Ludus SSH password.
- [Fix] **Shared VM start/stop** — `PUT /api/admin/vm` accepts key-only Proxmox auth (previously required a non-empty password even when a root key was mounted).

**GOAD**
- [Fix] **Long `provide` → `provision_lab` stall** — `goad-ludus-reconcile` now resolves the Ludus range from `.goad_range_id`, SQLite **`goad_instance_ranges`**, or **`deploy_handoffs`** (by `taskId` / `instanceId`) when the SSH sidecar file is missing. **Deploy-poll detection** accepts a few alternate Ludus status strings. **`appendLine` reconcile** no longer joins the entire in-memory GOAD log (was O(n) every 6 lines and could freeze Node on 30+ minute streams); it passes the last **25 000** lines only so PocketBase `SUCCESS` patching keeps up and GOAD can exit `provide` into `provision_lab`.

**Docs**
- [Improve] **Getting started (requirements)** — Optional GOAD row now calls out **`sudo`** on the Ludus server for minimal Debian/Proxmox-style installs (`apt`-style reminder).

---

## [1.0.0] — 2026-05-13

**LUX**
- [Add] First stable release — out of beta!
- [Add] **Range Configuration → Firewall Rules** — Toolbar next to **Apply to Config** adds **Save Config**, **Force** (same testing-mode `--force` flag as the page header), and **Deploy Firewall Rules** (merge rules into YAML, save to Ludus, then deploy with the `network` tag only).
- [Docs] **README** — Root readme is a short overview + quick links; long-form install, SSH, env, features, architecture, dev, API, and screenshots live under **[docs/](docs/index.md)**.
- [Improve] **Range logs → History** — Saved deploy logs show clock times the same way as the live log, in order top to bottom, without confusing extra digits on the time.
- [Improve] **Groups → remove a shared range** — Adding or removing a range from a group may need that range’s **router** machine turned on first. Dialog box now allows router power operations and ability to add/remove from the group.
- [Improve] **Refresh feedback** — Groups, GOAD home (including recent activity), and the console **Reconnect** button show a brief spinner while things load again.
- [Fix] **Range sidebar** — `refreshRanges()` now invalidates every scoped `ranges/accessible` query so deleted ranges disappear reliably after impersonation / cache timing quirks
- [Fix] **Dashboard** — No more brief HTTP 400 error on the home dashboard while a range is deploying or live logs are connecting
- [Fix] **GOAD → Deploy New Instance** — Abort deploy (with toast) when dedicated Ludus range creation fails instead of running GOAD with no `LUDUS_RANGE_ID`; re-select that range and refresh the accessible-range list before redirect so the shell sidebar matches the GOAD lab
- [Fix] **Ludus admin & range creation** — Infer admin API URL when unset; `POST /ranges/create` (and GOAD init-range) use the session Ludus key first, with optional ROOT fallback.
- [Fix] **Settings root API key** — Persists to SQLite, encrypted at rest, env overrides DB, trims BOM/quotes.
- [Security] **Impersonation API key** removed from `sessionStorage` — key lives only in the encrypted `httpOnly` session cookie; all server routes derive it via `resolveAdminImpersonationFromRequest`
- [Security] **Task stream IDOR** — non-admin access to `/api/goad/tasks/:id/stream` for an unknown task now returns 404
- [Security] **Proxy error sanitisation** — internal exception details logged server-side only; client receives generic `"Internal proxy error"`
- [Security] **Impersonation header merge** — both `X-Impersonate-*` headers required together; a single header falls back to the session cookie
- [Perf] **GOAD wizard redirect** — instant redirect to instance page on first `[TASKID]` SSE event; 30-minute poll removed
- [Perf] **TanStack `staleTime` audit** — admin ranges, GOAD instance lists, and task lists promoted to `STALE.medium`

**GOAD**
- [Add] **Resizable log split** — Drag the center handle between **Ludus range logs** and **GOAD logs** on Deploy Status and Logs History; panel widths persist (browser localStorage).
- [Improve] **GOAD deploy history** — History rows read more clearly when a small firewall-only redeploy comes right after a big GOAD run, so labels and GOAD log groupings are less likely to look wrong.
- [Improve] **GOAD terminal** — If the live stream ends without a clear “finished with exit code …” line, the UI still learns success or failure from the server once the task has stopped.
- [Fix] **Range logs** — Ansible line colouring ignores benign JSON `"failed": false`; GOAD instance/new pages fill the shell below the impersonation banner without hard-coded `100vh` offsets.
- [Fix] **Extension Installations** — Lab setup and each add-on now run one after another on the server so nothing gets skipped.

**Docs**
- [Add] `docs/workflows.md` — plain-English guide: Ludus ranges, GOAD instances, two-stage deploy, redeployment, network rules queue, and admin impersonation
- [Add] `docs/architecture.md` — GOAD task flow diagram, SSE stream resume notes, updated design decisions
- [Add] `docs/features.md` — dedicated Admin Impersonation and GOAD redeploy semantics sections
- [Add] `docs/about.md` — GOAD ↔ Ludus relationship summary

---

## [0.9.9] — 2026-05-07

**LUX**
- [Improve] **Slow Ludus responses** — The app waits longer for heavy work (snapshots, deploys, powering VMs, template builds, testing allow/deny, and similar). If the wait times out but the job might still be running, messaging is clearer and many pages refresh their view instead of only showing a scary error.
- [Improve] **Log timestamps** — Live range/GOAD lines use the Ludus host’s clock when SSH is set up, so times read like the server you’re deploying to—not only the app container’s timezone.
- [Perf] **Post-refresh load time** — PBKDF2 session key is derived once per process (middleware + RSC no longer repeat expensive crypto); TanStack no longer invalidates hydrated range/blueprint cache on every mount; sidebar nav links use `prefetch={false}` to cut RSC storms; server passes a small **shell session** snapshot so the header/sidebar skip redundant `/api/auth/session` calls; effective scope skips a network round-trip when it already matches the server.
- [Add] **Settings → Ludus Performance** — Live charts (CPU, memory, load) for every Proxmox node returned by `pvesh`, polled over root SSH (same auth as SSH & GOAD).
- [Fix] **Snapshots page** — Create, revert, and delete now match what Ludus expects and stay tied to the range you selected, so bulk actions actually run instead of looking like they did nothing.
- [Fix] **Testing mode stop stuck** — Treat Ludus ERROR/ABORTED as terminal for testing ops (Ansible can fail mid-play while state still looks deploying). One automatic `testing/stop` retry after 4 min; POST body `dismissStuckOp` clears a stuck DB op; Testing page shows **Unlock UI** after 90s and toasts on server-reported op failure.

**GOAD**
- [Add] **GOAD lab — Range logs** — **Refresh** on the range log panel reconnects the live stream when new lines stop appearing (handy right after kicking off a deploy).
- [Add] **GOAD lab — Install** — One action runs **Provide** then **Provision lab** with a plain-language confirmation. Action order is Install → Provide → Provision Lab → Sync IPs, then the rest; only **Install** stays highlighted in green.
- [Fix] **GOAD provide → provision (Ludus)** — `goad-ludus-reconcile` uses a **3 MB** Ludus log tail (was 200 KB), strips `[HH:MM:SS]` prefixes before PLAY RECAP parsing, throttled `[goad-ludus-reconcile]` diagnostics when root API key / `instanceId` / `.goad_range_id` / admin range state are missing or `/range/logs` fails, **8** deploy-poll lines when recap is only in Ludus logs (was 10), and reconcile runs every **12** GOAD log lines (was 18).

---

## [0.9.8] — 2026-05-06

**LUX**
- **[Breaking] Docker / TLS layout** — Compose includes an **nginx** edge container (`ludus-ux-web`) for HTTPS on host **:443**; Defaults **`DISABLE_HTTPS=true`** + **`TRUST_PROXY_TLS=true`** so session cookies stay correct behind TLS termination. 
  - **TLS PEMs** for nginx moved from repo-root **`certificates/`** to **`docker/nginx/certificates/`** (`cert.pem`, `key.pem`) — **migrate files** before or after pull; nginx generates self-signed certs on first boot if missing.
- [Fix] Admin delete user — purge PocketBase `logs` rows that reference the user (`POST /api/users/purge-pocketbase-logs`) before Ludus `DELETE /user`; fixes referential integrity errors when deploy-run history exists
- [Fix] GOAD terminal word wrap — inner `<pre>` replaced with `<div>` (`white-space: pre` blocked wrapping); wrap on by default; scroll pane `min-w-0` for flex shrink
- [Improve] Light log theme — black body text on GOAD terminal and shared `LogViewer`; Ansible / PLAY RECAP line colours for light backgrounds via `ansibleClassForTheme`

**GOAD**
- [Fix] `provide` stuck on **deployment in progress (DEPLOYING)** after Ansible **PLAY RECAP** succeeds — LUX watches streamed GOAD logs; when Ludus never flips PocketBase `rangeState` off DEPLOYING/WAITING, writes **SUCCESS** via PB (same escape hatch as abort; requires configured Ludus root API key and root SSH to read `.goad_range_id`)
- [Fix] Dedicated-range deploy uses the logged-in API user — seed missing `~/.goad/goad.ini` with GOAD’s stock sections plus `[ludus] use_impersonation=no` before `goad.sh` (GOAD does not overwrite an existing file)
- [Fix] Ludus CLI shim omits `--range` for `ludus user …` so `user list` / `user list all` match GOAD expectations
- [Fix] When `LUDUS_RANGE_ID` is set, patch `use_impersonation=no` before and after `goad.sh` so stale configs cannot re-enable synthetic-user mode mid-session

---

## [0.9.7] — 2026-05-04

**LUX**
- [Add] Playwright smoke (`npm run test:e2e`) — optional `E2E_*` env vars; see `config/playwright.config.ts`
- [Add] Playwright: health, auth-gate, login UI, navigation, logout (`e2e/helpers/auth.ts`)
- [Improve] Tooling layout: `config/next.config.cjs`, `tailwind.config.ts`, `playwright.config.ts`, `postcss.config.cjs`, and `tsconfig.base.json` under `config/`
- [Perf] TanStack cache + `localStorage` namespaced per login/impersonation scope (`@sc` query keys); dashboard inventory cache keyed by scope; manual refresh no longer blocked by 15s poll
- [Fix] Admin manual impersonation waits for `/api/auth/impersonate` cookie before navigating home
- [Fix] Login: derive `isAdmin` from the correct Ludus `GET /user` row when the API returns an array; fixes missing admin sidebar for real admins
- [Fix] Stop calling Ludus `GET /range` without `rangeID` (404 on v2); dashboard range query waits for selection; logs page passes `rangeID`; remove SSR prefetch that hit bare `/range`
- [Fix] Dashboard: merge partial or empty `GET /range` VM lists with cached rows — use `numberOfVMs` when it exceeds `VMs.length`, union-merge subset responses; manual refresh / 15s poll no longer intermittently drops VMs

---

## [0.9.6] — 2026-04-29

**LUX**
- [Add] Range Configuration: optional **Force save & deploy** (`--force`) for Ludus testing mode — applies to config upload and to `POST /range/deploy`
- [Add] Dashboard: **Destroy all VMs** (range object kept) via `DELETE /range/{rangeID}/vms`; confirmation copy contrasts with **Delete Range**
- [Add] VM Operations audit entry for bulk destroy-all-VMs
- [Fix] `ConfirmBar` preserves newline characters in multi-line confirmation prompts (`whitespace-pre-line`)
- [Fix] Configuration page: removed non-functional yaml-language-server schema tip banner
- [Security] **postcss** 8.5.10+ (CVE-2026-41305 / GHSA-qx2v-qp2m-jg93) — direct devDependency; `overrides.next.postcss` so Next’s nested copy matches patched release

---

## [0.9.5] — 2026-04-28

**LUX**
- [Add] Additional controls on streamed and static logs — pause (freeze display while the buffer keeps filling), toggle auto-follow, font size stepper (A− / A+), word-wrap, light vs dark log pane, search with match navigation, copy all, download, clear
- [Add] Shared `LogDockToolbar` across `LogViewer` (Dashboard, Range Logs, Templates, Testing, Range Config, …) and `GoadTerminal` (GOAD instance pages); Range Logs toolbar shows Live when SSE is connected
- [Fix] Log body font-size now follows the toolbar (`.log-line` no longer pinned `text-xs`, which blocked resizing on Ludus Ansible output)
- [Fix] noVNC resolves the Proxmox node from cluster resources by VMID before creating the VNC proxy ticket, instead of assuming the first node.
- [Fix] noVNC missing-password errors now clearly explain that Proxmox HTTP tickets require the user's PAM password; SSH keys still work for SPICE and `pvesh` paths only.
- [Fix] noVNC now authenticates to Proxmox as the logged-in LUX user's PAM account (`proxmoxUsername@pam`) using the user's session password, instead of reusing `PROXMOX_SSH_USER` / root PAM credentials.
- [Security] `proxmoxSshPassword` saved from the Settings UI is encrypted at rest in SQLite using `APP_SECRET`; existing plaintext values are rewritten encrypted on next settings load.
- [Docs] README now separates root SSH auth from browser-console PAM auth and adds VNC 401 troubleshooting.
- [Docs] Quickstart now explains the optional root `PROXMOX_SSH_PASSWORD` and that in-browser noVNC uses the logged-in user's password.
- [Docs] `scripts/upgrade.sh` — upgrade/downgrade helper; quiet `git fetch`, lists active remote branches and tags via `git ls-remote` (no stale deleted branches), supports tag checkout; README section updated.

---

## [0.9.4] — 2026-04-20

**LUX**
- [Fix] Range stuck in "Deploying…" / Abort visible after deploy errors — `deploying` flag now cleared when Ludus GET returns a terminal state; stream-completion fallback added for streams that end without a `[DONE]` message
- [Add] Deploy History and Build History — click any past run to view full output; paginated (5/page)
- [Add] VM operation audit log — per-VM destroy and extension removal logged on Dashboard and Range Logs
- [Add] Per-VM destroy action from the Dashboard range card
- [Add] Settings page redesigned with tabs (General, SSH & GOAD, Branding, About)
- [Add] About tab — version badge, release notes accordion, and dependency list
- [Fix] Abort shows "Aborting…" immediately and polls until range exits DEPLOYING
- [Fix] Power On/Off scoped to selected range — fixes errors on non-default ranges
- [Fix] Monaco NLS console warning and favicon 404 eliminated
- [Fix] Range Config save toast surfaces actual Ludus error instead of generic message
- [Security] Next.js 15.5.15 — patches GHSA-q4gf-8mx6-v5v3 (Server Components DoS)

**GOAD**
- [Add] Deployment pipeline graphic (Step 1 → Step 2) shown when post-GOAD firewall restore is needed
- [Add] Live elapsed-time timers on GOAD Deploy Status and dashboard; persist across page refresh
- [Add] GOAD terminal streams to any browser or session — sessionStorage dependency removed
- [Add] Dashboard pulsing GOAD badge and in-card banner while Ansible provisioning runs
- [Add] "Open GOAD Instance" jump button on Dashboard for GOAD-mapped ranges
- [Add] Unified GOAD + Ludus row in Logs History with correlated metadata and timing
- [Add] Remove extension — destroys Ludus VMs and strips entries from range-config.yml
- [Fix] GOAD logs stream correctly on page refresh — no longer stuck on empty terminal
- [Fix] Abort button deduplicated — single control in toolbar only
- [Fix] Network YAML comparison now semantic — eliminates false-positive post-GOAD firewall deploys
- [Fix] Trailing quote removed from GOAD Logs History extension names
- [Fix] Ansible `{{ range_id }}` resolved to actual value in VM operation audit entries
- [Add] GOAD task phase, network flags, and start time persisted server-side in SQLite

---

## [0.9.3] — 2026-04-10

**LUX**
- [Add] Firewall Rules visual editor on Range Configuration page (drag-and-drop reorder)
- [Add] Firewall Rules step in Deploy New Range wizard
- [Add] VLAN smart dropdowns — grouped Range VLANs, Special keywords, and Custom number
- [Add] NetworkRule / NetworkConfig types and utility functions in network-rules.ts
- [Fix] Deploy Logs not streaming — correctly passes selectedRangeId to startStreaming
- [Fix] Ansible ports schema error — `ports: all` emitted when `protocol: all`
- [Fix] iptables rule ordering — rules written reversed to match Ludus `-I` insert semantics
- [Fix] Deploy Logs panel moved above toolbar for immediate visibility without scrolling
- [Improve] Protocol and Action dropdowns display text centred for readability

**GOAD**
- [Add] Firewall Rules step in Deploy New GOAD Instance wizard

---

## [0.9.2] — 2026-04-02

- [Security] Next.js 15.5.14 — patches GHSA-h25m-26qc-wcjf (RSC-related DoS)
- [Fix] React 18.3.1 pinned as minimum for Next 15 compatibility

---

## [0.9.1] — 2026-04-01

- [Add] Root SSH via private key — mount Ludus host root key; optional password fallback
- [Add] Settings → Test root SSH & admin API with SSH key probe diagnostics
- [Add] Blueprints — sharing and apply workflows (current vs new range)
- [Add] Groups — checklist UX for assigning ranges and users
- [Fix] Root SSH mount edge cases — CRLF normalisation, chown, clearer auth error messages

---

## [0.9.0] — 2026-03-30

**LUX**
- [Add] Initial beta release — web UI for Ludus cyber range management
- [Add] Dashboard with live range status, deployment state, and VM overview
- [Add] Deploy New Range wizard (multi-step) and raw YAML mode
- [Add] Range Configuration editor with syntax highlighting and live deploy
- [Add] Testing Mode with SQLite-backed durable state and allowed domains/IPs
- [Add] Snapshots, Blueprints, and Ansible Roles pages
- [Add] Range Logs with SSE streaming and download
- [Add] Admin: Ranges Overview, Users, and Groups management
- [Add] noVNC in-browser VM console via Proxmox WebSocket proxy
- [Add] PocketBase integration for authoritative range and testing state
- [Add] SSH admin tunnel for Ludus admin API access from Docker
- [Add] HTTPS support with self-signed or custom TLS certificates
- [Add] Custom branding — uploadable logo and configurable app name
- [Add] Dark/light theme, sidebar range selector, and session-aware impersonation

**GOAD**
- [Add] GOAD Management — deploy, manage, and stream GOAD instances
