# Ludus UX (LUX) — documentation

Start with the [project README](../README.md) for a short overview, then use these pages as needed.

| Topic | Description |
|--------|----------------|
| [About LUX](about.md) | Why use it, Ludus Pro vs LUX, GOAD/Ludus relationship |
| [Workflows](workflows.md) | **How it works** — Ludus ranges, GOAD instances, deploy steps, redeployment, firewall queue, impersonation (start here if you're new) |
| [Getting started](getting-started.md) | Requirements, Docker, install (quickstart or manual), upgrade |
| [SSH and authentication](ssh-and-auth.md) | Root vs session auth, consoles, admin API URL, SSH keys |
| [Environment variables](environment.md) | `.env`, Compose mounts, TLS, DNS |
| [Features](features.md) | What the UI covers (ranges, GOAD, admin, impersonation, etc.) |
| [Templates](templates.md) | Packer template builds in LUX, add-from-source, Proxmox ACL troubleshooting |
| [Architecture](architecture.md) | Stack, request flow, GOAD task diagram, design notes |
| [Persistent data](persistent-data.md) | What lives under `data/` and related paths |
| [Development](development.md) | Local `npm run dev`, Playwright E2E |
| [API](api.md) | OpenAPI spec and Swagger UI |
| [Screenshots](screenshots.md) | UI gallery |

Other files in this folder:

- [`openapi.yaml`](openapi.yaml) — OpenAPI 3.1 for LUX HTTP routes
- [`playwright.yaml`](playwright.yaml) — Playwright / WSL notes (referenced from [Development](development.md))
