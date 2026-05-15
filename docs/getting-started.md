# Getting started

## Requirements

| Requirement | Details |
|---|---|
| **Ludus server** | v2.x with API access on port 8080 (tested with [**Ludus v2.1.0**](https://gitlab.com/badsectorlabs/ludus/-/releases)) |
| **Docker + Docker Compose** | Any recent version (tested on Docker 24+) |
| **Network access** | Container must reach the Ludus server on ports 8080 (API) and 22 (SSH) |

**Optional** (for full functionality):

| Feature | Requires |
|---|---|
| GOAD lab management | [GOAD](https://github.com/Orange-Cyberdefense/GOAD) on the Ludus server + `python3.11-venv` + **`sudo`** (minimal Debian / Proxmox may not ship `sudo`; install with e.g. `apt install -y sudo` as root before using GOAD from LUX) |

## Verify Docker and Compose

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

## Ludus API key in bashrc

Before installing LUX, add the `LUDUS_API_KEY` to `/root/.bashrc` and per-user `~/.bashrc` on the Ludus server. This is the API key used to authenticate to Ludus.

If you have not already added your root `LUDUS_API_KEY` to `/root/.bashrc` on your Ludus server:

```bash
ssh root@<ludus-server> "echo 'export LUDUS_API_KEY=<root-api-key>' >> /root/.bashrc"
```

For each Ludus user that should expose their API key to LUX over SSH:

```bash
ssh <admin-user>@<ludus-server> "echo 'export LUDUS_API_KEY=<user-api-key>' >> ~/.bashrc"
```

## Automated setup (recommended)

From a clone of this repo, with **Python 3**, **Docker**, **Docker Compose** (`docker compose` or `docker-compose` — see above), and (for option **1** below) **`scp`/`ssh`** available:

```bash
cd ludus-ux
bash scripts/quickstart.sh
```

> The script **exits early** if `docker` or docker compose is missing, with hints for Linux and Windows installation.

## Manual setup

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
   | Root SSH | Private key under `SSH_KEY_PATH` (default `./ssh/id_rsa`) **or** set `PROXMOX_SSH_PASSWORD` for server-side admin operations. In-browser noVNC uses the logged-in user's PAM password separately. |

> As of **0.9.5**, the `PROXMOX_SSH_PASSWORD` value saved through Settings is encrypted in SQLite with `APP_SECRET`. Environment variables are still environment variables; protect `.env`, backups, and Docker host access accordingly.

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

4. (Optional) Add your own TLS cert + key for the **nginx** edge proxy: place `cert.pem` and `key.pem` in **`docker/nginx/certificates/`** before the first start. If missing, the nginx container generates a self-signed pair on first boot:

```bash
mkdir -p docker/nginx/certificates
cp <path-to-your-cert.pem> docker/nginx/certificates/cert.pem
cp <path-to-your-key.pem> docker/nginx/certificates/key.pem
chmod 644 docker/nginx/certificates/cert.pem
chmod 600 docker/nginx/certificates/key.pem
```

If you previously used the repo-root **`certificates/`** directory, move those files into **`docker/nginx/certificates/`**.

5. Confirm Docker and Compose (same checks the quickstart script performs):

```bash
docker --version
docker compose version
```

6. Start the stack (nginx on **:443**, app on internal HTTP only):

```bash
docker compose up -d --build
# https://localhost   (port 443 — expected self-signed cert warning if using generated certs)
```

7. Log in with your Ludus user’s (not root!) **SSH username and password**. LUX stores that password in the encrypted session for per-user GOAD and in-browser noVNC tickets. The UI reads `LUDUS_API_KEY` from `~/.bashrc` on the Ludus server when possible.

> **GOAD prerequisite:** If you plan to use GOAD lab deployments, the GOAD repository must be present on your Ludus server along with the Python venv package:
> ```bash
> git clone https://github.com/Orange-Cyberdefense/GOAD.git /opt/GOAD
> apt install python3.11-venv
> ```

## Upgrade and downgrade

Use this when you already have a **git clone** of the repo on the Docker host. The helper script talks to **whatever remote your clone uses** (`origin` if present, otherwise the first remote)—GitHub, GitLab, or any other URL.

**What it does**

1. Quiet `git fetch` from your remote (`--prune --tags`).
2. Lists **active branches** and **release tags** from the remote (`git ls-remote`).
3. You pick a branch or tag (interactive menu), **or** pass the name as the first argument (e.g. `main`, `v1.0.1`).
4. Checks out the branch (reset to remote tip) **or** the tag (detached HEAD). Local commits on a branch are discarded—stash first if needed.
5. Runs `docker compose up -d --build` (or `docker-compose` if that is what you use).

**Requirements:** `git`, `docker`, and Docker Compose on `PATH`.

```bash
cd ludus-ux
bash scripts/upgrade.sh
```

Non-interactive (examples):

```bash
bash scripts/upgrade.sh main
bash scripts/upgrade.sh v1.0.1
```

Persistent data (`./data`, `./ssh`, `./docker/nginx/certificates`, `.env`) are on the host unchanged; SQLite settings and uploads survive the rebuild. Read release notes in [`CHANGELOG.md`](../CHANGELOG.md) before major jumps—database migrations are forward-compatible when noted there; **downgrading** to an older branch may not be supported if schema or env expectations changed.

## Quick SSH sanity check

With the stack up and `./ssh/id_rsa` readable in the container:

- Open **Settings** and run the Ludus / SSH connectivity checks.
- Hit an admin endpoint that uses `pvesh` (e.g. **Shared services** or **SPICE** download) — both use SSH with the same auth resolution as GOAD.

For deeper SSH, console, and key troubleshooting, see [SSH and authentication](ssh-and-auth.md).
