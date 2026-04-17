# Changelog

All notable changes to Ludus UX (LUX) will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.9.4] — Beta — 2026-04-17

### Security
- **Next.js 15.5.15** — patches [GHSA-q4gf-8mx6-v5v3](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3) (Server Components DoS).

### Added

**GOAD**
- **Batch install extensions** — on the instance **Extensions** tab, **Add** queues extensions into a side **install cart** (order preserved); **Install # extensions** confirms then runs one GOAD task that chains `install_extension` per entry and switches to **Deploy Status** for output (same REPL `--repl` mechanism as a single install). Deploy / Logs History titles list every extension for that run.
- **Dashboard provisioning indicator** — pulsing badge + "Open GOAD" banner on range cards while a GOAD task is running, so you know when Ansible is still applying after the Ludus range flips to SUCCESS.
- **"GOAD Instance" jump button** on the Dashboard toolbar — appears only for ranges that belong to a GOAD instance and deep-links straight into the instance page, so lifecycle actions (install extension, provision lab, provide) are one click away.
- **Unified GOAD row in Logs History** — correlates Ludus deploys with GOAD tasks and shows one row with both sides' metadata.
- **Remove extension** — destroys matching Ludus VMs and cleans up the GOAD instance state *and* strips the extension's VM entries from Ludus `range-config.yml` so a later Provide or full deploy doesn't re-materialise the VMs.
- **Faster instance list** — cards render as soon as they load instead of waiting on the session probe.
- **Deploy log resets on each new run** so GOAD output no longer appends onto stale lines.

**History**
- **Deploy History** on Range Logs and **Build History** on Templates — click any past run to view its full output; auto-refreshes on completion.
- **Pagination** — history lists show 5 entries per page.

**VM operation audit log**
- Every per-VM destroy and GOAD extension removal (success or failure) is logged and shown in a "VM Operations" panel on the Dashboard and Range Logs. Open views auto-refresh when new rows appear.

**Dashboard**
- **Per-VM destroy** — Destroy action on each VM row, scoped to the selected range.

**Misc**
- **Changelog dialog** — click the sidebar version label to view release notes.

### Fixed

**GOAD instance page**
- **Single Abort control** — the Deploy Status tab no longer duplicated the toolbar Abort (two buttons during extension install; three after a stuck-DEPLOYING warning). Abort lives only in the top action bar; the stuck-deploy alert is text-only with a pointer to that button.
- **Abort confirmation** — toolbar Abort opens the same ConfirmBar flow as Provide/Destroy before calling the API.
- **Abort button after success** — no longer stays visible for ~20s from session grace; shown only while deploy is active or an abort request is in-flight; clears local abort marker on success.
- **Deploy Status after refresh / navigate** — first paint respects `?tab=` and a mid-flight `provide` / `install-extension` in sessionStorage (Deploy tab, not Terminal). Resume range SSE uses `snapshotStart: false` so Ludus log buffer repopulates instead of staying empty until the next new line; auto-tab latch no longer resets before `resumeTask` runs.
- **Default tab + valid `?tab=`** — opening `/goad/:id` without a query now selects **Deploy Status**; Dashboard **Open GOAD** links use `?tab=deploy` (was `?tab=logs`, which matched no tab). Unknown `?tab=` values normalize to Deploy Status; legacy `?tab=logs` maps to Deploy Status.

**Dashboard & VM actions**
- **Deploy History row parity** — while GOAD tasks were loading, the list fell back to plain Ludus rows (no action title / split duration / line count). The Dashboard now waits for GOAD task metadata, then uses the same correlated rows as the GOAD instance Logs History. The instance page list reuses exported `CorrelatedHistoryRow`.
- **Power On/Off on non-default ranges** — now scoped to the selected range, fixing `Range <id> not found for user <user>` on GOAD-mapped or deleted-default ranges.
- **GOAD banner wording during deploy** — headline reflects live range state instead of always saying "Range deploy finished".
- **Abort "comes back to life"** — Dashboard now shows "Aborting…" immediately after an Abort / Force Abort click and polls Ludus every 2 s until the range actually leaves `DEPLOYING`, instead of flipping back to "Deploying…" on the next status poll.
- **Refresh button "last updated" time now ticks** — the timestamp next to the Wifi icon is driven by the query's `dataUpdatedAt` instead of a state slot that only bumped when the payload deep-changed, so background polls and manual refreshes are always visible even when nothing in Ludus changed.
- **VMs no longer flash in and out of the range card** — a transient empty `VMs` array from Ludus (Proxmox hiccup / mid-deploy) now preserves the previously-cached VM list, unless the range itself reports a terminal state (DESTROYED / NEVER DEPLOYED / ERROR).
- **Dashboard Deploy History now shows the running GOAD task** — `Provision lab` / `Install extension` / `Provide` tasks that haven't yet triggered a Ludus range deploy appear as first-class rows (matching the GOAD instance Logs History), so the "3 entries" / "4 entries" mismatch between the two views is gone. Range Logs gets the same treatment.
- **Side-by-side Logs History status badges are now column-scoped** — `Ludus deploy` + its status sits above the Ludus terminal, `GOAD task` + its status sits above the GOAD terminal
- **Templates › Build History filters out range deploys by default** — Ludus `/templates/logs/history` returns every log run it has on disk (template builds + range deploys). The page now keeps only rows whose `template` field matches a known template name; a "Show all log runs" toggle surfaces the raw list when needed, and the header reports the hidden-row count.
- **Dashboard + Range Logs Deploy History now match the GOAD instance Logs History** — rows for GOAD-integrated runs show the GOAD action title ("Install extension: elk", "Provision lab", …) and break out the full run window as `Xm Ys deploy · Am Bs provision · total`. The provision phase is measured from *after* the Ludus deploy ends so the Ansible overlap isn't double-counted, and goad-only tasks (e.g. a `Provision lab` that never triggered a range deploy) appear as first-class rows alongside Ludus deploys. Ludus-only rows still get a `Range Deploy` badge for parity.

**Firewall rules preserved across GOAD actions**
- **Pre-inject** — the user's current `network:` block is now pushed into GOAD's `workspace/<id>/providers/ludus/config.yml` over SSH *before* Install extension / Provision lab / Provision extension run. GOAD's `ludus range config set` then carries the rules forward, so Ludus range-config is never written without them and the Ansible deploy applies iptables correctly from the start — no midway iptables flush. Post-action restore + `deploy(["network"])` stays in as a safety net for Provide (which regenerates config.yml from templates).
- **Restore no longer trampled manual edits** — the post-action restore now re-reads `range-config.yml` on each retry and short-circuits when the latest YAML already has an equivalent `network:` block, instead of PUTing a stale snapshot that could clobber a user's in-flight save on `/range/config`.

**UI polish**
- **Inline confirmations** — Install / Re-provision / Remove extension prompts and single-template Build / Delete prompts now appear under the row that triggered them instead of jumping to the top of the page.
- **Range Config page 404s in the browser console** — `/range/config` and `/range` no longer fire against the Ludus default-range fallback when no range is selected yet. The page shows an empty state instead.
- **Favicon** — browser tab, bookmark, and `/favicon.ico` probes now use the current LUX logo (custom upload or bundled default); no more `favicon.ico` 404 in the console.
- `/api/logo` no longer 404s when no custom logo is uploaded.
- **Monaco "Failed trying to load default language strings" warning** on the Range Config page — loader now disables NLS lookup instead of probing the missing `vs/nls.messages.*` files we don't ship under `/monaco-vs`.
- **GOAD** badge + deep-link only appear on deploy-history rows that actually correlate with a GOAD task.
- Range Config save toast surfaces the real Ludus warning (quota / schema) instead of a generic message.

### Changed
- **`useGoadStream.run`** — returns the process exit code when the stream finishes.
- **README** — documents GOAD firewall preservation, correlated GOAD badge, and history pagination.
- **Codebase slim (zero-behavior-change)** — removed dead exports, unused `ludusApi` wrappers, unused query keys, an unused API route, an unused `Progress` component and its dependencies. Consolidated duplicated `timeAgo` / `extractArray` helpers.

---

## [0.9.3] — Beta — 2026-04-10

### Added
- **Firewall Rules visual editor** — collapsible panel on the Range Configuration page lets operators add, edit, reorder, and delete `network.rules` entries without touching YAML. Rules are serialized back into the range config via "Apply to Config" and saved with the normal "Save Config" button.
- **Drag-and-drop rule ordering** — rule rows are draggable (native HTML5 DnD) with a grip handle; evaluation order matches iptables top-to-bottom processing so order matters and is preserved.
- **Firewall Rules wizard step — Deploy New Range** — a "Network Rules" step (between Domain Setup and Deploy Tags) lets rules be defined before first-time deployment. Existing configs are pre-populated from the parsed range YAML.
- **Firewall Rules wizard step — GOAD** — the Deploy New GOAD Instance wizard includes a "Network Rules" step (between Select Range and Review & Deploy). Rules are injected into the range config before GOAD's Ansible run so the `network` tag enforces them on the router.
- **VLAN smart dropdowns** — Source VLAN and Destination VLAN fields are now grouped `<Select>` menus with three sections: *Range VLANs* (auto-populated from VMs in the current config), *Special* (`wireguard`, `public`, `all`), and *Custom number…* (reveals a numeric input for any VLAN 1–255). Powered by the new `extractVlansFromConfig()` utility.
- `NetworkRule` / `NetworkConfig` types and `extractNetworkRules()`, `injectNetworkRules()`, `buildNetworkYaml()`, `extractVlansFromConfig()` utilities in `src/lib/network-rules.ts` (backed by `js-yaml`).

### Fixed
- **Deploy Logs not streaming** — the Configuration page now passes `selectedRangeId` to `startStreaming()`. Previously, logs were polled against the default range even when a named range was selected, causing the panel to appear empty until a manual refresh.
- **Ansible `ports` schema error** — `ports` is always emitted in the YAML (it is required by the Ludus schema). When `protocol: all`, LUX forces `ports: all`; the Ansible port-number assertion is only evaluated when `ports` is a specific value, so `all` passes cleanly. The Ports input is disabled in the UI when protocol is `all`.
- **iptables rule ordering** — Ludus applies each rule with `iptables -I` (insert at chain head), which reverses YAML order in the chain. `injectNetworkRules` and `buildNetworkYaml` now write rules in reversed order, and `extractNetworkRules` reverses on read, so the order displayed in LUX matches the top-to-bottom evaluation order in iptables.
- **Deploy Logs panel position** — the Deploy Logs card on the Configuration page is now rendered at the top of the page (above the toolbar) so streaming output is immediately visible without scrolling past the YAML editor.
- **Firewall Rules UI alignment** — the info banner icon and the Firewall Rules card header title were rendering below vertical centre. The banner was refactored from a Radix `Alert` (absolute-positioned icon) to a plain flex row; the `CardHeader` padding was made symmetric so the title row sits centred.

### Changed
- Protocol and Action dropdowns and compact inputs in the Firewall Rules form display text centred for improved readability.
- The New Range wizard option description updated to include "networking" in the feature summary.

---

## [0.9.2] — Beta — 2026-04-02

### Security
- **Next.js 15.5.14** — addresses [GHSA-h25m-26qc-wcjf](https://github.com/advisories/GHSA-h25m-26qc-wcjf) (HTTP request deserialization / RSC-related DoS) and related advisories fixed in the 15.5.10+ line. Requires App Router updates: async `cookies()` in `getSession()`, async dynamic `params` in API routes, and `serverExternalPackages` in `next.config.js`.

### Changed
- **React 18.3.1** (pinned minimum) — compatible with Next 15 peer range.
- **eslint-config-next** aligned with Next 15.5.14.

---

## [0.9.1] — Beta — 2026-04-01

### Added
- **Root SSH via private key** — mount the Ludus host’s root key on the LUX host (`SSH_KEY_PATH` → `/app/ssh`); optional `PROXMOX_SSH_PASSWORD` for password auth. Entrypoint adjusts key ownership/mode for the `nextjs` user.
- **Settings → Test root SSH & admin API** — verifies root SSH and admin API reachability from the container; **SSH key probe** shows env paths, per-file `readdir` names (`nameJson`), symlink/dangling detection, and readable flags.
- Optional **private key path** persisted in SQLite (`proxmoxSshKeyPath`) plus discovery of keys under `/app/ssh` using exact directory entry names.
- **Blueprints** — sharing and apply workflows: user/range pickers, apply dialog (current vs new range), and guarded empty submits (builds on blueprint browse/import from 0.9.0).
- **Groups** — checklist-style UX for ranges and users; list-all users/ranges and assign-ranges-to-group API wiring (builds on groups management from 0.9.0).

### Changed
- **README / `.env.example`** — document copying the root key **from the Ludus server** into `SSH_KEY_PATH` (default `./ssh`), in-container `PROXMOX_SSH_KEY_PATH`, and **directory** permissions (`chmod 755` on `ssh/` on Linux) so the app user can traverse the mount.
- **VM inventory** — default table sort uses VM display name for easier scanning.
- **Users** — stricter validation for new user IDs (alphanumeric, letter-first) where enforced in the UI.

### Fixed
- Root SSH mount edge cases: writable `ssh` volume for entrypoint `chown`, CRLF normalization on private keys, and clearer errors when the key exists but SSH authentication still fails (e.g. `authorized_keys` on the Ludus host).

---

## [0.9.0] — Beta — 2026-03-30

### Added
- Initial beta release of LUX (Ludus UX) — web UI for Ludus cyber range management
- Dashboard with live range status, deployment state, and VM overview
- Deploy New Range wizard (multi-step: range selection → VMs → domain → deploy tags → review)
- Deploy New Range YAML mode — paste or upload raw Ludus config YAML directly
- Range Configuration editor with syntax highlighting and live deploy
- Testing Mode — start/stop testing, manage allowed domains/IPs with durable server-side state
- Testing Mode op tracking survives page navigation and re-login via SQLite-backed ops store
- Allowed domains/IPs pending state persisted in SQLite (survives browser close)
- Snapshots page — list, create, revert, and delete Proxmox VM snapshots
- Blueprints page — browse, import, and manage Ludus community blueprints
- Ansible Roles — browse and install Ansible Galaxy roles
- Range Logs — live SSE log streaming with download support
- GOAD Management — deploy, manage, and stream GOAD (Game of Active Directory) instances
- Admin: Ranges Overview, Users management, Groups management
- noVNC in-browser VM console (VNC WebSocket proxy via Proxmox)
- PocketBase integration for authoritative testingEnabled / rangeState status
- SSH admin tunnel for Ludus admin API access from Docker
- HTTPS support with self-signed or custom TLS certificates
- Custom branding: uploadable logo, configurable app name
- Dark/light theme support
- Sidebar range selector with per-range testing-enabled and deploying status dots
- Timestamped container logs with level tags (INFO / WARN / ERROR)
- Search bar in log viewers (GOAD terminal and range log) with match navigation

### Fixed
- VNC upstream TypeError when closing with reserved close code 1006
- PocketBase ranges filter falling back gracefully to full-scan on unsupported Ludus builds
- Testing mode button briefly showing wrong state after page navigation (op-initialising guard)
