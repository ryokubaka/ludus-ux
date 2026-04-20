# Changelog

All notable changes to Ludus UX (LUX) will be documented in this file.

---

## [0.9.4] — 2026-04-20

**LUX**
- [Fix] Range stuck in "Deploying…" / Abort visible after deploy errors — `deploying` flag now cleared when Ludus GET returns a terminal state; stream-completion fallback added for streams that end without a `[DONE]` message
- [Add] Deploy History and Build History — click any past run to view full output; paginated (5/page)
- [Add] VM operation audit log — per-VM destroy and extension removal logged on Dashboard and Range Logs
- [Add] Per-VM destroy action from the Dashboard range card
- [Add] Settings page redesigned with Dockhand-style tabs (General, SSH & GOAD, Branding, About)
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
