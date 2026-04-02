# Changelog

All notable changes to Ludus UX (LUX) will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
