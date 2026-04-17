# Ludus User eXperience (LUX)

![Ludus User eXperience](./images/lux_logo_large.jpeg)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Status: Beta](https://img.shields.io/badge/status-beta-blue)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()
[![GitHub Stars](https://img.shields.io/github/stars/ryokubaka/ludus-ux)](https://github.com/ryokubaka/ludus-ux/stargazers)

**LUX** is an open-source web front end for [Ludus](https://docs.ludus.cloud) cyber-range operations. It exists because teams wanted a browser-native way to design ranges, run deployments, manage users and groups, integrate [GOAD](https://github.com/Orange-Cyberdefense/GOAD), and handle day-two tasks (snapshots, testing mode, templates, blueprints) without living in the CLI—while keeping the stack self-hosted and inspectable.

## Table of contents

- [Why use LUX?](#why-use-lux)
- [Ludus Pro vs LUX](#ludus-pro-vs-lux)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [SSH authentication (root vs session)](#ssh-authentication-root-vs-session)
- [Configuration](#configuration)
- [Features](#features)
- [Persistent Data](#persistent-data)
- [Architecture](#architecture)
- [Development](#development)
- [API Reference](#api-reference)
- [Images](#images)
- [License](#license)
- [Author](#author)


### Why use LUX?

- **Operators and builders** who prefer visual workflows, shared UIs, and fewer copy-paste errors across SSH sessions.
- **Training and lab leads** who need impersonation, group-based access, blueprint sharing, and inventory visibility in one place.
- **Red/blue/purple teams** who want Ludus features (isolation, snapshots, range YAML) with extra glue: GOAD task history, admin range overview, shared-service helpers, and more.

### Ludus Pro vs LUX

Ludus ships a first-party **Pro Web UI** with a commercial license. Teams can request a **Pro NFR (Not For Resale)** license at no cost for qualified use — see [Ludus pricing](https://ludus.cloud/#pricing). That path gives you the native supported UI and Pro capabilities under Bad Sector Labs’ terms.

**LUX** is **Apache-2.0**, community-driven, and overlaps many Pro-style workflows (range design, consoles, templates, blueprints, GOAD, admin tooling) while adding its own features and integrations. Pick official Pro if you want vendor-supported closed-source plugins and SLAs; pick **LUX** if you want open source, forkability, and the feature set described below (or you can even run both in parallel for comparison!).

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
| **Ludus server** | v2.x with API access on port 8080 (tested with [**Ludus v2.1.0**](https://gitlab.com/badsectorlabs/ludus/-/releases)) |
| **Docker + Docker Compose** | Any recent version (tested on Docker 24+) |
| **Network access** | Container must reach the Ludus server on ports 8080 (API) and 22 (SSH) |

**Optional** (for full functionality):

| Feature | Requires |
|---|---|
| GOAD lab management | [GOAD](https://github.com/Orange-Cyberdefense/GOAD) on the Ludus server + `python3.11-venv` |

---

## Quick Start

### Verify Docker and Compose

Confirm the Docker CLI and Compose are on your **PATH** before running the quickstart script or starting the stack:

```bash
docker --version
docker compose version
```

If `docker compose` is not found, try the legacy standalone client:

```bash
docker-compose --version
```

If only `docker-compose` works, use `docker-compose up …` wherever these docs use `docker compose up …`.

| Environment | Notes |
|---|---|
| **Linux** | Install [Docker Engine](https://docs.docker.com/engine/install/) and the Compose V2 plugin (e.g. `docker-compose-plugin` on Debian/Ubuntu). If commands fail with permission errors, add your user to the `docker` group and sign in again. |
| **Windows (Git Bash + [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/))** | Start Docker Desktop. Under **Settings → General**, enable **Use Docker Compose V2**. Open a **new** Git Bash or IDE terminal after install so `docker` resolves (Docker adds its CLI directory to PATH). |

---

Before we install LUX, we need to add the `LUDUS_API_KEY` to the `/root/.bashrc` and `~/.bashrc` on the Ludus server. This is the API key that will be used to authenticate to the Ludus server.

### Ludus server: `LUDUS_API_KEY` in `~/.bashrc`

If you have not already added your root `LUDUS_API_KEY` to `/root/.bashrc` on your Ludus server:

```bash
ssh root@<ludus-server> "echo 'export LUDUS_API_KEY=<root-api-key>' >> /root/.bashrc"
```

For each Ludus user that should expose their API key to LUX over SSH:

```bash
ssh <admin-user>@<ludus-server> "echo 'export LUDUS_API_KEY=<user-api-key>' >> ~/.bashrc"
```

### Automated setup (recommended)

After completing the steps above -

From a clone of this repo, with **Python 3**, **Docker**, **Docker Compose** (`docker compose` or `docker-compose` — see [Verify Docker and Compose](#verify-docker-and-compose)), and (for option **1** below) **`scp`/`ssh`** available:

```bash
cd ludus-ux
bash scripts/quickstart.sh
```

> Note: The script **exits early** if `docker` or docker compose is missing, with hints for Linux and Windows installation.


### Manual setup

1. Clone and enter the repository

```bash
git clone <repo-url> ludus-ux && cd ludus-ux
cp .env.example .env
```

2. Edit `.env` from `.env.example`. **Required for a working stack:**

   | Variable | Purpose |
   |---|---|
   | `LUDUS_SSH_HOST` | Ludus server hostname or IP (SSH, GOAD, and default Ludus API URLs) |
   | `APP_SECRET` | Long random secret for session encryption (`openssl rand -hex 32`) |
   | `LUDUS_ROOT_API_KEY` | Ludus v2 root API key (admin users/ranges) — from `/opt/ludus/install/root-api-key` on the server |
   | Root SSH | Private key under `SSH_KEY_PATH` (default `./ssh/id_rsa`) **or** set `PROXMOX_SSH_PASSWORD` |


3. **Root SSH private key: from the Ludus server onto the LUX host**

   Privileged operations (admin API tunnel, `pvesh`, password changes, etc.) use **root SSH** to the **same** machine Ludus runs on (the Proxmox host). The **private key normally originates on that Ludus server** — you **copy it off the server** and place it on the machine where you run Docker (the LUX host).

   - **`SSH_KEY_PATH`** (in `docker-compose.yml`, overridable via `.env`) is the **host** directory that is bind-mounted to **`/app/ssh`** in the container. Default: **`./ssh`** next to the `docker-compose.yml`.
     - Put the key in `./ssh` as a **normal file**, e.g. **`./ssh/id_rsa`**. 
   - **`PROXMOX_SSH_KEY_PATH`** in `.env` is the path **inside** the container (default **`/app/ssh/id_rsa`**) and should match that filename.


   **If the key “is there” but LUX cannot read it:** use **Settings → Test root SSH** and inspect **SSH key probe**

   Example: copy **`/root/.ssh/id_rsa`** from the Ludus server to the default mount directory:

```bash
mkdir -p ssh
chmod 755 ssh
scp -P 22 root@<ludus-host>:/root/.ssh/id_rsa ssh/id_rsa
chmod 600 ssh/id_rsa
```

4. (Optional) Add your own cert + key to the `certificates/` directory to host the UI. If not provided, LUX will auto-generate self-signed certs:

```bash
cp <path-to-your-cert.pem> certificates/cert.pem
cp <path-to-your-key.pem> certificates/key.pem
chmod 600 certificates/cert.pem
chmod 600 certificates/key.pem
```

5. Confirm Docker and Compose ([Verify Docker and Compose](#verify-docker-and-compose)) — same checks the quickstart script performs:

```bash
docker --version
docker compose version
```

6. Start the container:

```bash
docker compose up -d --build
# https://localhost       (port 443 — expected self-signed cert warning)
# http://localhost:3000   (plain HTTP, also available)
```

7. Log in with your Ludus user’s (not root!) **SSH username and password** (used for per-user GOAD and session context). The UI reads `LUDUS_API_KEY` from `~/.bashrc` on the Ludus server when possible.

> **GOAD prerequisite:** If you plan to use GOAD lab deployments, the GOAD repository must be present on your Ludus server along with the Python venv package:
> ```bash
> git clone https://github.com/Orange-Cyberdefense/GOAD.git /opt/GOAD
> apt install python3.11-venv
> ```

### Quick SSH sanity check

With the stack up and `./ssh/id_rsa` readable in the container:

- Open **Settings** and run the Ludus / SSH connectivity checks.
- Hit an admin endpoint that uses `pvesh` (e.g. **Shared services** or **SPICE** download) — both use SSH with the same auth resolution as GOAD.

---

## SSH authentication (root vs session)

| Mechanism | What it’s for |
|---|---|
| **`PROXMOX_SSH_PASSWORD` or root key** (`PROXMOX_SSH_KEY_PATH`, default `/app/ssh/id_rsa`) | Server-side root SSH: admin tunnel to Ludus admin API, `pvesh` (SPICE, admin VM delete/power, shared pool discovery), GOAD impersonation, template install, log tail via SSH, `chpasswd`, rolling API keys in user `~/.bashrc`. **Key auth is the recommended default** on hardened Proxmox hosts. |
| **User password stored in session (login)** | Per-user GOAD, and **fallback** for `pvesh` when root password/key is not set. |

Optional: `PROXMOX_SSH_KEY_PASSPHRASE` for encrypted SSH keys.

### Admin API URL (`LUDUS_ADMIN_URL`)

- **Typical:** `https://<same-host-as-LUDUS_URL>:8081` whenever Ludus listens for admin traffic on a address your **container** can reach (LAN IP or DNS name). `docker-compose.yml` defaults to that pattern.
- **Loopback-only 8081 on the Ludus box:** LUX can start an SSH tunnel and forward `127.0.0.1:18081` → the server’s `127.0.0.1:8081`. That requires working **root SSH** at container startup. If you set `LUDUS_ADMIN_URL` to a **non-localhost** host name, LUX **does not** overwrite it with the tunnel URL.
- **Settings → Admin API URL** is persisted in SQLite and overrides the value from the environment until you change it again.

### Root private key copied from the Ludus server

Copying **`id_rsa` off the box** is only half of SSH key authentication:

- **LUX (client)** needs the **private** key file (`id_rsa`).
- **sshd on the Ludus server** needs the matching **public** key in **`/root/.ssh/authorized_keys`**.

`/root/.ssh/id_rsa` on the server is often used for **outgoing** SSH (e.g. git) and its public half is **not** automatically trusted for **incoming** root logins. If that line is missing, you will see “All configured authentication methods failed” even though the key file is correct.

**One-time fix on the Ludus server (as root)** — append this keypair’s **public** line to `authorized_keys`:

```bash
mkdir -p /root/.ssh
chmod 700 /root/.ssh
if [ -f /root/.ssh/id_rsa.pub ]; then
  cat /root/.ssh/id_rsa.pub >> /root/.ssh/authorized_keys
else
  ssh-keygen -y -f /root/.ssh/id_rsa >> /root/.ssh/authorized_keys
fi
chmod 600 /root/.ssh/authorized_keys
```

Then restart LUX’s container and run **Settings → Test root SSH & admin API**.

**Alternative (cleaner):** generate a **new** keypair only for LUX on your workstation (`ssh-keygen`), put the **`.pub`** line in `/root/.ssh/authorized_keys` on the server, and mount only that **private** key in `./ssh/id_rsa`.

### Other SSH key notes

- The image has **no `ssh` CLI** — use **Settings → Test root SSH & admin API**, not `docker exec … ssh`.
- Use **OpenSSH PEM** keys (`id_rsa` / `id_ed25519`), not PuTTY **`.ppk`**.
- **CRLF** in the key file is normalized when LUX loads the key; **`dos2unix ./ssh/id_rsa`** on the host is still safe if you hit parse errors.

---

## Configuration

All configuration is in `.env`. See [`.env.example`](.env.example) for the full list with descriptions.

### Core Settings

| Variable | Description | Default |
|---|---|---|
| `LUDUS_SSH_HOST` | Ludus server hostname or IP | — |
| `LUDUS_SSH_PORT` | SSH port | `22` |
| `LUDUS_SERVER_IP` | Optional IP when `LUDUS_SSH_HOST` is not resolvable inside the container | — |
| `LUDUS_URL` | Ludus API URL (port **8080**) | Compose default: `https://` + `LUDUS_SSH_HOST` + `:8080`; override in `.env` if needed |
| `APP_SECRET` | Session encryption key (32+ chars) | — |
| `LUDUS_VERIFY_TLS` | Verify Ludus TLS certificate | `false` |

### Docker Compose (host → container)

| Variable | Description | Default |
|---|---|---|
| `SSH_KEY_PATH` | **Host** directory where you put the root private key **copied from the Ludus server**. Mounted at **`/app/ssh`** in the container. | `./ssh` |
| `DATA_DIR` | **Host** directory for SQLite, uploads, GOAD task logs (`/app/data` in the container) | `./data` |

### Admin / User Management

| Variable | Description |
|---|---|
| `LUDUS_ADMIN_URL` | Admin API base URL (port **8081**). Compose default uses `LUDUS_SSH_HOST` with `:8081` (override in `.env` if needed). Prefer `https://<ludus-host>:8081` when reachable from the container. SSH tunnel to `127.0.0.1:18081` is optional when 8081 is loopback-only; remote URLs are not overwritten by the tunnel. |
| `LUDUS_ROOT_API_KEY` | Root API key (from `/opt/ludus/install/root-api-key` on the server) |
| `PROXMOX_SSH_USER` | Root (or privileged) SSH user for server-side Proxmox/Ludus operations |
| `PROXMOX_SSH_PASSWORD` | Optional if using key auth |
| `PROXMOX_SSH_KEY_PATH` | Private key path **inside** the container; must match the file under `SSH_KEY_PATH` on the host (default `/app/ssh/id_rsa`) |
| `PROXMOX_SSH_KEY_PASSPHRASE` | Optional passphrase for the key |

### GOAD

| Variable | Description | Default |
|---|---|---|
| `ENABLE_GOAD` | Show GOAD in the UI (`false` to hide) | `true` |
| `GOAD_PATH` | Path to the GOAD installation on the Ludus server | `/opt/GOAD` |
| `GOAD_SSH_KEY_PATH` | Optional override for key discovery (usually same as `PROXMOX_SSH_KEY_PATH`) | — |

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

- **Dashboard** — VM table (sortable by display name), power state, bulk/per-VM power controls, **per-VM destroy** (Ludus `DELETE /vm/{vmID}`), range state, deploy/abort, SSE deployment logs, optional Ansible inventory modal; **Deploy History** deep-links to a GOAD instance’s Logs History (side-by-side Ludus + GOAD) when the range is mapped in LUX’s GOAD range store
- **Range Config Editor** — Monaco YAML for `range-config.yml`, save, selective Ansible tags, live logs
- **Firewall Rules Editor** — Collapsible visual panel on the Config page to add, edit, reorder (drag-and-drop), and delete `network.rules` entries without hand-editing YAML; "Apply to Config" merges rules into the Monaco editor. Also available as a wizard step in Deploy New Range and Deploy New GOAD Instance flows.
- **New Range Wizard** — Guided flow: range selection → templates → domain → **firewall rules** → tags → deploy
- **Range Logs** — Standalone SSE viewer with timestamps, download, clear; snapshot mode for post-connect streams; deploy history list matches Dashboard behavior (**GOAD** rows open the GOAD instance history view when linked)

### Testing & Snapshots

- **Testing Mode** — Isolated network, allowlists, pending-state reconciliation against Ludus API delays
- **Snapshots** — Create, revert, delete across range VMs; per-VM and by snapshot name

### Infrastructure

- **Templates** — List, build, stop, delete Packer templates; install from official Ludus GitLab or custom sources
- **Blueprints** — Save/share/deploy range configs; user & group ACLs, unshare, apply-to-range workflow
- **Ansible Roles** — Galaxy roles and collections (add with version pin, list, remove)

### VM Access

- **Consoles** — noVNC in browser (needs PAM password path); SPICE / VNC `.vv` via `pvesh` over SSH (works with key-based root SSH)
- **Console range picker** — Choose any accessible range and VM from the Consoles page

### GOAD Integration

- **Overview & wizards** — Instances load without waiting on a full session round-trip before cards appear; live deploy streams, dedicated range per instance, task history with resumable SSE; Deploy New Instance wizard includes a **Firewall Rules** step to define router iptables rules before the Ansible run
- **Range YAML vs Range Configuration** — GOAD **Provide**, **Provision lab**, and **Install extension** refresh Ludus `range-config.yml` from GOAD templates (which would overwrite edits you made in the Range Configuration UI). After a successful run, LUX re-applies your saved `network:` block (firewall defaults + rules) onto the new YAML so UI-defined firewall rules are preserved; other top-level keys still come from GOAD until you edit them again in Ludus or the UI.
- **Instance actions** — Provision, provide, start/stop, destroy, force-delete, sync IPs, stop running Ansible
- **Extensions** — Install via **Add** (queue to side cart) and **Install # extensions** (confirm, chained `install_extension` in cart order, then **Deploy Status**), re-provision, **remove** (destroys extension VMs via Ludus and updates `instance.json` + workspace inventories over SSH). VM destroys and extension removals append rows to the local SQLite table `vm_operation_log` (`POST /api/vm-operation-log`), surfaced in the UI as a **VM Operations** panel on the Dashboard (collapsible, next to Deploy History) and on the Range Logs page (dedicated card) via `GET /api/vm-operation-log?rangeId=…` — non-admins are scoped to their own rows; admins see everyone by default and can pass `?username=…`. You can also inspect directly with e.g. `sqlite3 data/ludus-ux.db "SELECT datetime(ts/1000,'unixepoch'),kind,vm_id,vm_name,extension_name,status,detail FROM vm_operation_log ORDER BY ts DESC LIMIT 30"` on the LUX host.
- **Dashboard provisioning indicator** — For GOAD-mapped ranges, the Dashboard range header shows a pulsing `GOAD: <kind>` badge and an in-card banner with an "Open GOAD" link whenever a GOAD task (`provide` / `install_extension` / `provision_lab` / `provision_extension`) is still running, even after the Ludus range deploy itself flips to `SUCCESS`. Dashboard polls `/api/goad/tasks` every 3 s while anything is running and auto-refreshes range status + deploy history when the task ends.
- **Logs History** — Integrated GOAD + Ludus runs show as a single **GOAD** row; click for side-by-side range deploy log and GOAD CLI output (standalone Ludus deploys still show as Range Deploy). Detail view includes id/time/template metadata for Ludus and GOAD. **Deep links**: `?tab=history&deployLogId=` opens that deploy; range→instance mapping uses `GET /api/goad/by-range` (SQLite + enriched instances fallback). **Dashboard / Range Logs** only tag a deploy with **GOAD** when it correlates with a GOAD task (time overlap or proximity); manual range-config deploys stay plain Ludus rows. Deploy history there is paginated (5 per page).
- **Inventory** — View workspace inventory from the UI

### Users & Groups *(admin)*

- **Users** — Create/delete, roll keys, change passwords, WireGuard export, admin flag, impersonation banner + context
- **Groups** — Members and ranges, shared access control, range removal from groups

### Admin Panel

- **Ranges overview** — All ranges, ownership hints persisted in SQLite
- **Shared services** — ADMIN pool VMs (Nexus, Ludus Share), deploy/start/stop/console/delete

### Settings & Branding

- Runtime settings persisted in SQLite (URLs, SSH, GOAD path, secrets)
- Custom logo upload
- Ludus API and SSH connectivity tests

---

## Persistent Data

All persistent state lives in the `data/` directory (Docker volume):

| Path | Contents |
|---|---|
| `data/ludus-ux.db` | SQLite: settings, GOAD tasks, range ownership, pending ops, instance→range mappings, `vm_operation_log` (VM/extension deletion audit) |
| `data/tasks/` | GOAD task log files |
| `data/uploads/` | Custom logo |
| `certificates/` | TLS material (auto-generated or provided) |
| `SSH_KEY_PATH` (default `./ssh/`) | Root private key **from the Ludus server**, placed on the LUX host; mounted at **`/app/ssh`**. Writable mount so the entrypoint can `chown` for user `nextjs`. Use **`chmod 755`** on this directory on Linux. |

---

## Architecture

### Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, React 18) |
| UI | Tailwind CSS, Radix UI (shadcn-style), Lucide |
| Code editor | Monaco (YAML) |
| Terminal/console | noVNC (esbuild bundle), xterm.js |
| SSH | `ssh2` (server-side only) |
| Database | `better-sqlite3` |
| WebSockets | Custom `ws` server for VNC proxy |

### Request Flow

```
Browser
  │
  ├─ HTTPS (port 443/3000) ──► Next.js (App Router)
  │                                 │
  │                                 ├─ /api/proxy/* ──► Ludus API (8080/8081)
  │                                 ├─ /api/goad/*  ──► SSH → Ludus server (GOAD)
  │                                 ├─ /api/admin/* ──► SSH → Proxmox (pvesh)
  │                                 └─ /api/console/* ► SSH → Proxmox (pvesh) + HTTP for noVNC tickets
  │
  └─ WSS (same port) ────────► ws-server.ts ──► Proxmox VNC WebSocket
```

### Key Design Decisions

- **No external database** — SQLite under `data/` is the only persistence layer
- **Session-encrypted credentials** — User SSH password in an `httpOnly` cookie for GOAD reuse
- **Admin credential hygiene** — Root password, root API key, and stored SSH password are not returned to non-admin clients
- **SSE** — Deployment and GOAD logs stream over Server-Sent Events
- **Task persistence** — GOAD task IDs in `sessionStorage` for stream resume across navigation

---

## Development

```bash
npm install
npm run dev
# http://localhost:3000
```

For local development, set `DISABLE_HTTPS=true` in your `.env` to skip TLS.

---

## API Reference

The OpenAPI 3.1 spec lives at [`docs/openapi.yaml`](docs/openapi.yaml).

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

## Images

Screenshots follow roughly the same flow as [Features](#features): range operations first, then infrastructure, snapshots & testing, GOAD, admin, and identity. The hero logo at the top of this README is [`images/lux_logo_large.jpeg`](./images/lux_logo_large.jpeg); the square mark is at the end of this section.

### Range operations

**Dashboard** — VM table, range state, deploy / abort, deploy logs.

![Dashboard](./images/dashboard.png)

**Range config** — Monaco YAML editor, selective tags, live logs.

![Range config](./images/rangeconfig.png)

**New range** — wizard / deploy flow.

![New range](./images/newrange-1.png)

**Range logs** — standalone SSE viewer, download, clear.

![Range logs](./images/rangelogs.png)

### VM access

**Console in browser** — noVNC session.

![Console in browser](./images/consoleinbrowser.png)

### Infrastructure

**Templates** — Packer templates.

![Templates](./images/templates.png)

**Blueprints** — save, share, apply configs.

![Blueprints](./images/blueprints.png)

**Ansible roles & collections** — Galaxy-style add / list / remove.

![Ansible roles and collections](./images/ansiblerolescollections.png)

### Snapshots & testing mode

**Snapshots** — per-VM and range-wide snapshot tools.

![Snapshots](./images/snapshots.png)

**Testing mode** — disabled, enabled, and in-progress states.

![Testing mode off](./images/testing-off.png)

![Testing mode on](./images/testing-on.png)

![Testing mode in progress](./images/testing-inprogress.png)

### GOAD & admin

**GOAD** — instances, deploy streams, task history.

![GOAD management](./images/goad-mgmt.png)

**Ranges overview** — admin-style range list.

![Range overview](./images/rangeoverview.png)

### Users & groups

**Users**

![Users](./images/users.png)

**Groups**

![Groups](./images/groups.png)

### Branding

**App icon** (JPEG).

![LUX icon](./images/lux_logo_icon.jpeg)

---

## License

[Apache-2.0](LICENSE) — Copyright (C) 2026 LUX Contributors

This project is not affiliated with or endorsed by [Ludus](https://github.com/badsectorlabs/ludus) or [GOAD](https://github.com/Orange-Cyberdefense/GOAD). See [NOTICE](NOTICE) for third-party attributions.

## Author

[ryokubaka](https://github.com/ryokubaka)
