# Changelog

All notable changes to Ludus UX (LUX) will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
