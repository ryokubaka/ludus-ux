# Ludus User eXperience (LUX)

![Ludus User eXperience](./images/lux_logo_large.jpeg)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Version](https://img.shields.io/badge/version-1.0.1-green)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()
[![GitHub Stars](https://img.shields.io/github/stars/ryokubaka/ludus-ux)](https://github.com/ryokubaka/ludus-ux/stargazers)

**LUX** is an open-source web front end for [Ludus](https://docs.ludus.cloud) cyber-range operations: design ranges, run deployments, manage users and groups, integrate [GOAD](https://github.com/Orange-Cyberdefense/GOAD), and handle day-two tasks (snapshots, testing mode, templates, blueprints) in the browser while keeping the stack self-hosted and inspectable.

> [!WARNING]
> **This project was largely AI-assisted and has not undergone a formal security audit.** It handles sensitive credentials and runs privileged operations against your Ludus/Proxmox infrastructure. **Review the source before production use.** Not affiliated with or endorsed by Ludus or GOAD.

## Documentation

| | |
|---|---|
| **[docs/index.md](docs/index.md)** | Full table of contents for install, SSH, env vars, features, architecture, dev, API, screenshots |
| **[CHANGELOG.md](CHANGELOG.md)** | Release notes |
| **[`.env.example`](.env.example)** | Environment variables with comments |

## Quick start (Docker)

1. On the **Ludus server**, ensure `LUDUS_API_KEY` is exported in `/root/.bashrc` (and per-user `~/.bashrc` for users that log into LUX). See [Getting started](docs/getting-started.md#ludus-api-key-in-bashrc).
2. On the **LUX host**, clone the repo and run:

```bash
cd ludus-ux
bash scripts/quickstart.sh
```

Or follow [manual setup](docs/getting-started.md#manual-setup) (`cp .env.example .env`, place root SSH key under `./ssh`, `docker compose up -d --build`). Then open **https://localhost** (port **443**; expect a self-signed cert warning unless you supply PEMs in `docker/nginx/certificates/`).

## Upgrade

On a machine that already has a git clone of this repo (same layout as manual setup):

```bash
cd ludus-ux
bash scripts/upgrade.sh           # interactive: pick remote branch or tag
bash scripts/upgrade.sh main      # non-interactive examples
bash scripts/upgrade.sh v1.0.1
```

The script fetches from your configured remote, checks out the chosen ref, then runs `docker compose up -d --build` (or `docker-compose` if that is what you use). Host paths **`./data`**, **`./ssh`**, **`./docker/nginx/certificates`**, and **`.env`** are left as-is so SQLite and keys survive the rebuild.

Full behavior, prerequisites, and downgrade notes: [Upgrade and downgrade](docs/getting-started.md#upgrade-and-downgrade). Release notes: [CHANGELOG.md](CHANGELOG.md).

## Requirements (short)

| | |
|---|---|
| **Ludus** | v2.x, API **8080**, SSH **22** |
| **Host** | Docker + Compose (v2 plugin or `docker-compose`) |
| **GOAD** (optional) | GOAD repo on the Ludus server + `python3.11-venv` |

## License & author

[Apache-2.0](LICENSE) — 2026 LUX Contributors. Third-party notices: [NOTICE](NOTICE).

[ryokubaka](https://github.com/ryokubaka)
