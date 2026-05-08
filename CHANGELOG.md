# Changelog

All notable changes to Ludus UX (LUX) will be documented in this file.

---

## [1.0.0] — 2026-05-07

**LUX**
- [Add] First stable release — out of beta!
- [Add] **GOAD — Resizable log split** — Drag the center handle between **Ludus range logs** and **GOAD logs** on Deploy Status and Logs History; panel widths persist (browser localStorage).
- [Fix] **GOAD / range logs** — Ansible line colouring ignores benign JSON `"failed": false`; GOAD instance/new pages fill the shell below the impersonation banner without hard-coded `100vh` offsets.

---

## [0.9.9] — 2026-05-07

**LUX**
- [Improve] **Slow Ludus responses** — The app waits longer for heavy work (snapshots, deploys, powering VMs, template builds, testing allow/deny, and similar). If the wait times out but the job might still be running, messaging is clearer and many pages refresh their view instead of only showing a scary error.
- [Improve] **Log timestamps** — Live range/GOAD lines use the Ludus host’s clock when SSH is set up, so times read like the server you’re deploying to—not only the app container’s timezone.
- [Perf] **Post-refresh load time** — PBKDF2 session key is derived once per process (middleware + RSC no longer repeat expensive crypto); TanStack no longer invalidates hydrated range/blueprint cache on every mount; sidebar nav links use `prefetch={false}` to cut RSC storms; server passes a small **shell session** snapshot so the header/sidebar skip redundant `/api/auth/session` calls; effective scope skips a network round-trip when it already matches the server.
- [Add] **Settings → Ludus Performance** — Live charts (CPU, memory, load) for every Proxmox node returned by `pvesh`, polled over root SSH (same auth as SSH & GOAD).
- [Fix] **Snapshots page** — Create, revert, and delete now match what Ludus expects and stay tied to the range you selected, so bulk actions actually run instead of looking like they did nothing.
- [Fix] **Testing mode stop stuck** — Treat Ludus ERROR/ABORTED as terminal for testing ops (Ansible can fail mid-play while state still looks deploying). One automatic `testing/stop` retry after 4 min; POST body `dismissStuckOp` clears a stuck DB op; Testing page shows **Unlock UI** after 90s and toasts on server-reported op failure.
- [Fix] **GOAD provide → provision (Ludus)** — `goad-ludus-reconcile` uses a **3 MB** Ludus log tail (was 200 KB), strips `[HH:MM:SS]` prefixes before PLAY RECAP parsing, throttled `[goad-ludus-reconcile]` diagnostics when root API key / `instanceId` / `.goad_range_id` / admin range state are missing or `/range/logs` fails, **8** deploy-poll lines when recap is only in Ludus logs (was 10), and reconcile runs every **12** GOAD log lines (was 18).

**GOAD**
- [Add] **GOAD lab — Range logs** — **Refresh** on the range log panel reconnects the live stream when new lines stop appearing (handy right after kicking off a deploy).
- [Add] **GOAD lab — Install** — One action runs **Provide** then **Provision lab** with a plain-language confirmation. Action order is Install → Provide → Provision Lab → Sync IPs, then the rest; only **Install** stays highlighted in green.
- [Fix] **Stuck “deploying” after Provide** — Same stuck-DEPLOYING class as above; companion changes in **goad-mod**

---

## [0.9.8] — 2026-05-06

**LUX**
- **[Breaking] Docker / TLS layout** — Compose includes an **nginx** edge container (`ludus-ux-web`) for HTTPS on host **:443**; Defaults **`DISABLE_HTTPS=true`** + **`TRUST_PROXY_TLS=true`** so session cookies stay correct behind TLS termination. 
  - **TLS PEMs** for nginx moved from repo-root **`certificates/`** to **`docker/nginx/certificates/`** (`cert.pem`, `key.pem`) — **migrate files** before or after pull; nginx generates self-signed certs on first boot if missing.
- [Fix] Admin delete user — purge PocketBase `logs` rows that reference the user (`POST /api/users/purge-pocketbase-logs`) before Ludus `DELETE /user`; fixes referential integrity errors when deploy-run history exists
- [Fix] GOAD terminal word wrap — inner `<pre>` replaced with `<div>` (`white-space: pre` blocked wrapping); wrap on by default; scroll pane `min-w-0` for flex shrink
- [Change] Light log theme — black body text on GOAD terminal and shared `LogViewer`; Ansible / PLAY RECAP line colours for light backgrounds via `ansibleClassForTheme`

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
- [Change] Tooling layout: `config/next.config.cjs`, `tailwind.config.ts`, `playwright.config.ts`, `postcss.config.cjs`, and `tsconfig.base.json` under `config/`
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
- [Change] Configuration page: removed non-functional yaml-language-server schema tip banner
- [Security] **postcss** 8.5.10+ (CVE-2026-41305 / GHSA-qx2v-qp2m-jg93) — direct devDependency; `overrides.next.postcss` so Next’s nested copy matches patched release

---

## [0.9.5] — 2026-04-28

**LUX**
- [Add] Additional controls on streamed and static logs — pause (freeze display while the buffer keeps filling), toggle auto-follow, font size stepper (A− / A+), word-wrap, light vs dark log pane, search with match navigation, copy all, download, clear
- [Add] Shared `LogDockToolbar` across `LogViewer` (Dashboard, Range Logs, Templates, Testing, Range Config, …) and `GoadTerminal` (GOAD instance pages); Range Logs toolbar shows Live when SSE is connected
- [Fix] Log body font-size now follows the toolbar (`.log-line` no longer pinned `text-xs`, which blocked resizing on Ludus Ansible output)
- [Fix] noVNC resolves the Proxmox node from cluster resources by VMID before creating the VNC proxy ticket, instead of assuming the first node.
- [Fix] noVNC missing-password errors now clearly explain that Proxmox HTTP tickets require the user's PAM password; SSH keys still work for SPICE and `pvesh` paths only.
- [Change] noVNC now authenticates to Proxmox as the logged-in LUX user's PAM account (`proxmoxUsername@pam`) using the user's session password, instead of reusing `PROXMOX_SSH_USER` / root PAM credentials.
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
- [Change] GOAD task phase, network flags, and start time persisted server-side in SQLite

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
- [Change] Protocol and Action dropdowns display text centred for readability

**GOAD**
- [Add] Firewall Rules step in Deploy New GOAD Instance wizard

---

## [0.9.2] — 2026-04-02

- [Security] Next.js 15.5.14 — patches GHSA-h25m-26qc-wcjf (RSC-related DoS)
- [Change] React 18.3.1 pinned as minimum for Next 15 compatibility

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
