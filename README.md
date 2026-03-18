# Ludus User eXperience (LUX)

![Ludus User eXperience](./images/lux_logo_large.jpeg)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()

A web UI for [Ludus](https://docs.ludus.cloud) cyber range management. Replaces the CLI with a modern browser-based interface and adds [GOAD](https://github.com/Orange-Cyberdefense/GOAD) integration.

---

> [!WARNING]
> **This project was largely vibe-coded (AI-assisted development) and has not undergone a formal security audit.**
>
> It handles sensitive credentials — SSH passwords, API keys, session secrets — and runs privileged operations against your Ludus/Proxmox infrastructure. **Review the source code yourself before deploying in any environment you care about.** Use at your own risk. Please raise an issue if you identify concerns.
>
> This is an independent tool and is not affiliated with or endorsed by Ludus or GOAD.

---

## Requirements

| Requirement | Details |
|---|---|
| **Ludus server** | v2.x with API access on port 8080 |
| **Docker + Docker Compose** | Any recent version (tested on Docker 24+) |
| **Network access** | Container must reach the Ludus server on ports 8080 (API) and 22 (SSH) |

**Optional** (for full functionality):

| Feature | Requires |
|---|---|
| User management | Admin API (port 8081) + ROOT API key |
| VM consoles (VNC/SPICE) | Proxmox root SSH credentials |
| GOAD lab management | Root SSH access + [GOAD](https://github.com/Orange-Cyberdefense/GOAD) installed on the Ludus server + `python3.11-venv` |
| Shared services (Nexus/Share) | Root SSH credentials + ADMIN Proxmox pool |

---

## Quick Start

```bash
# 1. Clone and configure
git clone <repo-url> ludus-ui && cd ludus-ui
cp .env.example .env
```

Edit `.env` with your values (at minimum):

```env
LUDUS_SSH_HOST=192.168.0.100        # Ludus server hostname or IP
APP_SECRET=<random-32-char-string>  # openssl rand -hex 32
LUDUS_URL=https://192.168.0.100:8080
```

(Optional) Add your own cert + key to the `certificates/` directory:

```bash
cp <path-to-your-cert.pem> certificates/cert.pem
cp <path-to-your-key.pem> certificates/key.pem
chmod 600 certificates/cert.pem
chmod 600 certificates/key.pem
```

Start the container:

```bash
# 2. Build and start
docker compose up -d --build

# 3. Open in browser
#    https://localhost       (port 443 — expected self-signed cert warning)
#    http://localhost:3000   (plain HTTP, also available)
```

If you have not already added your root LUDUS_API_KEY to your `/root/.bashrc` on your Ludus server, add it now:

```bash
ssh root@<your-ludus-server> "echo 'export LUDUS_API_KEY=<your-api-key>' >> /root/.bashrc"
```

If you have not already loaded the Ludus user's API key into your `~/.bashrc` on your Ludus server, load it now. You can find the API key by running `ludus-install-status` on your Ludus server:

```bash
ssh <admin-user>@<your-ludus-server> "echo 'export LUDUS_API_KEY=<your-api-key>' >> ~/.bashrc"
```

Log in with your Ludus admin user using SSH username and password. The UI reads your `LUDUS_API_KEY` from `~/.bashrc` on your Ludus server automatically.

> **GOAD prerequisite:** If you plan to use GOAD lab deployments, the GOAD repository must be present on your Ludus server along with the Python venv package:
> ```bash
> git clone https://github.com/Orange-Cyberdefense/GOAD.git /opt/GOAD
> apt install python3.11-venv
> ```

---

## Configuration

All configuration is in `.env`. See [`.env.example`](.env.example) for the full list with descriptions.

### Core Settings

| Variable | Description | Default |
|---|---|---|
| `LUDUS_SSH_HOST` | Ludus server hostname or IP | — |
| `LUDUS_SSH_PORT` | SSH port | `22` |
| `LUDUS_URL` | Ludus API URL (port 8080) | — |
| `APP_SECRET` | Session encryption key (32+ chars) | — |
| `LUDUS_VERIFY_TLS` | Verify Ludus TLS certificate | `false` |

### Admin / User Management

| Variable | Description |
|---|---|
| `LUDUS_ADMIN_URL` | Admin API URL (Ludus server port 8081); tunnel is automatically established between Ludus UX and Ludus server over docker bridge network port 18081 by the entrypoint script |
| `LUDUS_ROOT_API_KEY` | Root API key (from `/opt/ludus/install/root-api-key` on the server) |
| `PROXMOX_SSH_USER` | Root SSH user for console/GOAD access (default: `root`) |
| `PROXMOX_SSH_PASSWORD` | Root SSH password |

### GOAD

| Variable | Description | Default |
|---|---|---|
| `GOAD_PATH` | Path to the GOAD installation on the Ludus server | `/opt/GOAD` |

### TLS / HTTPS

The container serves HTTPS on port 3000 (mapped to 443 on the host). On first startup it auto-generates a self-signed certificate. To use your own cert, place `cert.pem` and `key.pem` in the `certificates/` directory before starting.

| Variable | Description |
|---|---|
| `TLS_HOSTNAME` | Hostname for the auto-generated cert CN/SAN |
| `TLS_CERT_PATH` | Custom cert path inside container (default: `/app/certificates/cert.pem`) |
| `TLS_KEY_PATH` | Custom key path inside container (default: `/app/certificates/key.pem`) |
| `DISABLE_HTTPS` | Set to `true` for plain HTTP (development only) |

### DNS Resolution

If `LUDUS_SSH_HOST` is a hostname Docker can't resolve (e.g. only in your host's `/etc/hosts`), set `LUDUS_SERVER_IP` to the server's IP and the container will inject it into `/etc/hosts` automatically.

---

## Features

### Range Management
- **Dashboard** — VM table with power state, bulk and per-VM power on/off, range state badge, deploy/abort controls, and live SSE deployment log streaming
- **Range Config Editor** — Monaco YAML editor for `range-config.yml` with save, selective Ansible tag deployment, and live log streaming with auto-scroll
- **New Range Wizard** — 5-step guided wizard: select existing or new range → add VMs from templates → domain setup → choose deploy tags → review and deploy
- **Range Logs** — Standalone live SSE log viewer with timestamps, download, and clear

### Testing & Snapshots
- **Testing Mode** — Start/stop isolated network mode, manage allowed domains/IPs with pending-state reconciliation for Ludus API sync delays
- **Snapshots** — Create, revert, and delete VM snapshots across all VMs in a range; view by VM or by snapshot name

### Infrastructure
- **Templates** — List, build, stop-build, and delete Packer VM templates; browse and one-click install from the official Ludus GitLab repository or a custom source
- **Blueprints** — Save range configs as named blueprints; view YAML, deploy directly, share with specific users or groups, delete
- **Ansible Roles** — Manage Ansible Galaxy roles and collections (list, add with optional version pin, delete)

### VM Access
- **VM Consoles** — In-browser VNC via noVNC WebSocket proxy; SPICE `.vv` file download for native clients; Proxmox authentication handled entirely server-side
- **Console Range Picker** — Select any accessible range and its VMs directly from the Consoles page

### GOAD Integration
- **GOAD Overview** — List all GOAD workspace instances with status, assigned Ludus range, and task history
- **New Lab Wizard** — Multi-step deployment: select lab type and extensions → verify template readiness → stream live output → auto-redirect to the new instance page
- **Instance Management** — Per-instance actions: Provision (install), Provide (deploy range + configure), Start/Stop, Sync IPs (fix stale inventory IPs), Destroy
- **Inventory Viewer** — Browse Ansible inventory files directly in the UI
- **Task History** — Full log replay for any past task with resumable SSE streaming (survives page navigation)
- **Stop Button** — Abort any running GOAD/Ansible command from the Deploy Status tab
- **Sync Range IPs** — One-click fix for stale `192.168.56.X` IPs in GOAD inventory files when the Ludus deployment IP differs

### User & Group Management *(admin)*
- **User Management** — Create/delete Ludus users, roll API keys, change Linux/PAM passwords, download WireGuard VPN configs, toggle admin status
- **Group Management** — Create/delete groups, add/remove users and ranges for shared access control
- **Admin Impersonation** — Act as any user from the admin UI with a persistent banner; full context switching including range selection and GOAD instances

### Admin Panel
- **Ranges Overview** — All ranges across all users with ownership assignment (resolved from multiple heuristic sources, persisted to SQLite)
- **Shared Services** — Detect Nexus cache and Ludus File Share VMs in the ADMIN Proxmox pool; deploy, start/stop, open console, or delete them
- **One-click Shared Service Deploy** — Deploy Nexus cache or Ludus File Share with a single button; uses tagged deployments (`-t nexus` / `-t share`) to avoid touching unrelated VMs

### Settings & Customization
- Runtime-editable settings (Ludus URL, SSH host, GOAD path, credentials) persisted to SQLite — survive container restarts
- Custom logo upload (replaces the default LUX logo in the sidebar)
- Live Ludus API connectivity test and SSH reachability check

---

## Persistent Data

All persistent state lives in the `data/` directory (Docker volume):

| Path | Contents |
|---|---|
| `data/ludus-ui.db` | SQLite database: settings overrides, GOAD task history, range ownership, pending operations, GOAD instance→range mappings |
| `data/tasks/` | GOAD task log files (one file per task, flat text) |
| `data/uploads/` | Custom logo (if uploaded) |
| `certificates/` | TLS certificates — auto-generated on first run, or user-provided |

---

## Architecture

### Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, React 18) |
| UI | Tailwind CSS, Radix UI primitives (shadcn/ui pattern), Lucide icons |
| Code editor | Monaco Editor (YAML) |
| Terminal/console | noVNC (bundled via esbuild), xterm.js |
| SSH | `ssh2` library (server-side only) |
| Database | `better-sqlite3` (SQLite, server-side only) |
| WebSockets | Custom `ws` server for VNC WebSocket proxy |

### Request Flow

```
Browser
  │
  ├─ HTTPS (port 443/3000) ──► Next.js (App Router)
  │                                 │
  │                                 ├─ /api/proxy/* ──► Ludus API (port 8080/8081)
  │                                 ├─ /api/goad/*  ──► SSH → Ludus server (GOAD)
  │                                 ├─ /api/admin/* ──► SSH → Proxmox (pvesh)
  │                                 └─ /api/console/* ► SSH → Proxmox API
  │
  └─ WSS (same port) ────────► ws-server.ts ──► Proxmox VNC WebSocket
```

### Key Design Decisions

- **No external database** — SQLite in `data/` is the only persistence layer; the container can restart without losing state
- **Session-encrypted credentials** — the user's SSH password is stored in an AES-256-GCM encrypted `httpOnly` cookie for the session lifetime so GOAD can reuse it without re-prompting
- **Admin-only credential gates** — Proxmox root password and root API key are never returned to non-admin clients
- **SSE over polling** — deployment logs and GOAD output are streamed via Server-Sent Events; no client-side polling loops
- **Task persistence** — GOAD task IDs are stored in `sessionStorage`; navigating away and back resumes the live stream without re-running the command


---

## Development

```bash
# Install dependencies
npm install

# Run in dev mode (plain HTTP on port 3000)
npm run dev

# Open http://localhost:3000
```

For local development, set `DISABLE_HTTPS=true` in your `.env` to skip TLS.

---

## API Reference

The full OpenAPI 3.1 spec lives at [`docs/openapi.yaml`](docs/openapi.yaml).

### Browsing with Swagger UI

```bash
docker run --rm -p 8088:8080 \
  -e SWAGGER_JSON=/docs/openapi.yaml \
  -v "$(pwd)/docs:/docs" \
  swaggerapi/swagger-ui
# Open http://localhost:8088
```

> **Authentication note:** All endpoints (except `/api/auth/login`, `/api/auth/logout`, and `/api/health`) require a valid session cookie set by `POST /api/auth/login`.

---

## License

[Apache-2.0](LICENSE) — Copyright (C) 2026 LUX Contributors

This project is not affiliated with or endorsed by [Ludus](https://github.com/badsectorlabs/ludus) or [GOAD](https://github.com/Orange-Cyberdefense/GOAD). See [NOTICE](NOTICE) for third-party attributions.

## Author

[ryokubaka](https://github.com/ryokubaka)