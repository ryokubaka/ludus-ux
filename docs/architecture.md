# Architecture

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, React 18) |
| UI | Tailwind CSS, Radix UI (shadcn-style), Lucide |
| Code editor | Monaco (YAML) |
| Terminal/console | noVNC (esbuild bundle) |
| SSH | `ssh2` (server-side only) |
| Database | `better-sqlite3` |
| WebSockets | nginx → Next.js `ws-server.ts` (VNC proxy); TLS at nginx edge |

## Request flow

```
Browser
  │
  ├─ HTTPS :443 ──► nginx (TLS) ──► HTTP :3000 ──► Next.js (App Router) / ws-server.ts
  │                      │                              │
  │                      │                              ├─ /api/proxy/* ──► Ludus API (8080/8081)
  │                      │                              ├─ /api/goad/*  ──► SSH → Ludus server (GOAD)
  │                      │                              ├─ /api/admin/* ──► SSH → Proxmox (pvesh)
  │                      │                              └─ /api/console/* ► SSH → Proxmox (pvesh) + user PAM HTTP for noVNC tickets
  │
  └─ WSS (same origin :443) ──► nginx ──► ws-server.ts ──► Proxmox VNC WebSocket
```

## Key design decisions

- **nginx edge in Compose** — TLS on host **:443**; app container speaks HTTP only on the internal network (`TRUST_PROXY_TLS` preserves secure cookies).
- **No external database** — SQLite under `data/` is the only persistence layer
- **Session-encrypted credentials** — User SSH/PAM password in an `httpOnly` cookie for GOAD and noVNC ticket reuse
- **Admin credential hygiene** — Root password, root API key, and stored SSH password are not returned to non-admin clients
- **SSE** — Deployment and GOAD logs stream over Server-Sent Events
- **Task persistence** — GOAD task IDs in `sessionStorage` for stream resume across navigation
