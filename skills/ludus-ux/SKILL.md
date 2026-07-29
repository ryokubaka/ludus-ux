---
name: ludus-ux
description: >
  Operate Ludus cyber ranges through Ludus UX (LUX) and the Ludus API — range
  config YAML, deploy tags, GOAD labs (LUX orchestration + blueprints), templates
  (register vs Packer build), snapshots, testing mode, networking, and LUX-only
  flows (GOAD, consoles). Use when helping with Ludus or Ludus UX from the in-app
  assistant or an IDE agent.
---

# Ludus UX skill (reference)

Operators manage **Ludus** cyber ranges through **Ludus UX (LUX)**. This skill is reference for routing — follow the assistant system prompt for voice and behavior.

## Docs before action (critical)

1. Open **`references/workflows/INDEX.md`** (topic → playbook path).
2. `search_documentation` / `read_documentation` with that **exact** path.
3. Then `ask_user` (copy options from the playbook) or call APIs listed there.
4. Never invent CLI flags, operationIds, or wizard options.

## Tools

| Tool | Use for |
|------|---------|
| `list_ludus_operations` / `describe_ludus_operation` / `call_ludus_api` | Ludus `/api/v2` |
| `list_lux_operations` / `describe_lux_operation` / `call_lux_api` | LUX `/api/*` |
| `ask_user` | Button prompts — only after reading the matching workflow playbook |
| `search_documentation` / `read_documentation` | Skill + LUX docs + Ludus cache |

Workflow: **docs → list/describe → ask_user (if needed) → call**. Destructive calls need UI confirmation.

Pass **camelCase `operationId` only** to `call_*`. Never pass `GET /templates` as the operationId.

## Prefer which surface?

See `references/lux-vs-ludus.md` and **`references/workflows/INDEX.md`**. Short rules:

- **GOAD / GOAD-Mini / NHA / SCCM** → playbook `workflows/goad-deploy.md` (`ask_user` path then in-chat wizard; `call_lux_api`)
- **Template register** → LUX `addTemplates`; **Packer build** → Ludus `buildTemplates` (`templates.md`)
- **Range deploy** → `workflows/range-deploy.md` (in-chat wizard via `ask_user`)
- **Uncertainty** → read playbook, then `ask_user`; never invent

## References

- **`workflows/INDEX.md`** — topic map (start here)
- **`workflows/goad-deploy.md`** — GOAD deploy playbook (no invented `--dedicated`)
- **`templates.md`** — register vs Packer build
- `lux-vs-ludus.md` / `lux-api.md` / `range-config.md` / `environment-guide.md`
- **Upstream Ludus depth** (supplement): `skills/ludus/range-config`, `ludus-cli`, `troubleshooting`, `environment-guide` — search/read those paths; do not override LUX playbooks

## Domain rules

1. Respect the user’s selected range ID for range-scoped ops.
2. Suggest validation header for YAML: `# yaml-language-server: $schema=https://docs.ludus.cloud/schemas/range-config.json`
3. Windows hostnames ≤ 15 chars; use `{{ range_id }}` in vm_name/hostname.
4. Confirm destructive actions (deploy, destroy, power, testing, delete, template Packer build, GOAD execute).
5. Never invent API operationIds — always list/describe first.
6. Never invent GOAD YAML, CLI flags, or template names — catalog / playbook / OpenAPI only.
7. Ask when the path is ambiguous — with `ask_user` options from the playbook.
