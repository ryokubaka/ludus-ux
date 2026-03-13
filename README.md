# Ludus User eXperience (LUX)

![Ludus User eXperience](./images/lux_logo_large.jpeg)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()

A web UI for [Ludus](https://docs.ludus.cloud) cyber range management. Replaces the CLI with a modern browser-based interface and adds [GOAD](https://github.com/Orange-Cyberdefense/GOAD) integration.

> **Not affiliated with Ludus or GOAD.** This is an independent companion tool that communicates over the public Ludus REST API.

---

## Requirements

| Requirement | Details |
|---|---|
| **Ludus server** | v2.x with API access on port 8080 |
| **Docker + Docker Compose** | Any recent version (tested on Docker 24+) |
| **Network access** | The container must reach your Ludus server on ports 8080 (API) and 22 (SSH) |

**Optional** (for full functionality):

| Feature | Requires |
|---|---|
| User management | Admin API (port 8081) + ROOT API key |
| VM consoles | Proxmox root SSH credentials |
| GOAD labs | SSH access + [goad-mod](https://github.com/Orange-Cyberdefense/GOAD) installed on the Ludus server |

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

```bash
# 2. Start
docker compose up -d --build

# 3. Open browser
#    https://localhost       (port 443, self-signed cert warning is expected)
#    http://localhost:3000   (also available)
```

Log in with your Ludus SSH username and password. The UI reads your API key from `~/.bashrc` automatically.

---

## Configuration

All configuration is in `.env`. See [`.env.example`](.env.example) for the full list with descriptions.

### Core Settings

| Variable | Description | Default |
|---|---|---|
| `LUDUS_SSH_HOST` | Ludus server hostname or IP | — |
| `LUDUS_SSH_PORT` | SSH port | `22` |
| `LUDUS_URL` | Ludus API URL (port 8080) | — |
| `APP_SECRET` | Session encryption key | — |
| `LUDUS_VERIFY_TLS` | Verify Ludus TLS cert | `false` |

### Admin / User Management

| Variable | Description |
|---|---|
| `LUDUS_ADMIN_URL` | Admin API URL (port 8081) |
| `LUDUS_ROOT_API_KEY` | Root API key (from `/opt/ludus/install/root-api-key` on the server) |
| `PROXMOX_SSH_USER` | Root SSH user for console access (default: `root`) |
| `PROXMOX_SSH_PASSWORD` | Root SSH password |

### TLS / HTTPS

The container serves HTTPS on port 3000 (mapped to 443 on the host). On first startup, it auto-generates a self-signed certificate. To use your own cert, place `cert.pem` and `key.pem` in the `certificates/` directory before starting.

| Variable | Description |
|---|---|
| `TLS_HOSTNAME` | Hostname for the auto-generated cert's CN/SAN |
| `TLS_CERT_PATH` | Custom cert path inside container (default: `/app/certificates/cert.pem`) |
| `TLS_KEY_PATH` | Custom key path inside container (default: `/app/certificates/key.pem`) |

### DNS Resolution

If `LUDUS_SSH_HOST` is a hostname that Docker can't resolve (e.g., it's only in your host's `/etc/hosts`), set `LUDUS_SERVER_IP` to the server's IP. The container will inject the mapping into its `/etc/hosts` automatically.

---

## Features

- **Dashboard** — VM status, range state, deploy and power actions
- **Range Config** — YAML editor (Monaco) for `range-config.yml` with deploy + log streaming
- **Testing Mode** — Start/stop with snapshot management, allowed domains/IPs firewall rules
- **Templates** — Build and manage Packer VM templates
- **Snapshots** — Create, revert, and delete VM snapshots
- **VM Consoles** — In-browser VNC and SPICE file download
- **Users & Groups** — Admin user management, WireGuard config, group access control
- **Blueprints** — Save and share range configurations
- **Ansible Roles** — Manage Galaxy roles and collections
- **GOAD** — Deploy and manage Game of Active Directory labs
- **Admin Impersonation** — Manage any user's ranges as an admin
- **Range Logs** — Live SSE log streaming during deployments

---

## Persistent Data

All persistent data is stored in the `data/` directory (volume-mounted):

| Path | Contents |
|---|---|
| `data/ludus-ui.db` | SQLite database (settings, task history, pending operations) |
| `data/tasks/` | GOAD task log files |
| `data/uploads/` | Custom logo upload |
| `certificates/` | TLS certificates (auto-generated or user-provided) |

---

## Development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

---

## Project Structure

```
src/                    Next.js application source
  app/                  Pages and API routes (App Router)
  lib/                  Server-side utilities, API clients, DB
  components/           React components (shadcn/ui + custom)
  hooks/                Custom React hooks
server/                 Custom WebSocket server (VNC proxy)
docker/                 Dockerfile and container entrypoint
docs/                   Developer documentation
```

---

## License

[AGPL-3.0](LICENSE) — Copyright (C) 2026 LUX Contributors

This project is not affiliated with or endorsed by [Ludus](https://github.com/badsectorlabs/ludus) or [GOAD](https://github.com/Orange-Cyberdefense/GOAD). See [NOTICE](NOTICE) for third-party attributions.
