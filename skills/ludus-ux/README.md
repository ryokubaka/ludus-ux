# ludus-ux skill

Agent skill shipped with Ludus UX for in-app and IDE assistants.

## Relationship to Bad Sector Labs ludus-skills

**Preferred for LUX:** this folder (`skills/ludus-ux`) — workflows, `ask_user` playbooks, LUX APIs.

**Supplement (underlying Ludus):** full upstream skills are vendored at [`skills/ludus/`](../ludus/) from [badsectorlabs/ludus-skills](https://gitlab.com/badsectorlabs/ludus-skills) (MIT). Indexed for `search_documentation` / `read_documentation` — not dumped into the system prompt.

Thin adapted summaries still live under `references/range-config.md`, `troubleshooting.md`, `environment-guide.md`, and `ludus-cli.md`; for depth, read the matching path under `skills/ludus/`.

LUX also adds:

- `lux-api.md` / `lux-vs-ludus.md` — Ludus UX HTTP API and routing
- `workflows/*` — in-chat deploy wizards
- Tools that call **both** Ludus `/api/v2` and LUX `/api/*`

You do **not** need `npx skills add badsectorlabs/ludus-skills` separately for the in-app assistant; both trees ship under `skills/`.

## In-app use

The LUX assistant loads `SKILL.md` + short routing refs into the system prompt. Heavy Ludus schema/CLI/troubleshooting comes from docs search over `skills/ludus/**` and `skills/ludus-ux/**`.

## IDE use (Cursor / Claude)

Point your agent at `skills/ludus-ux` (preferred) and optionally `skills/ludus` for platform depth. Pair with Ludus MCP ([docs](https://docs.ludus.cloud/docs/using-ludus/mcp)) if you want IDE-side Ludus API execution outside LUX.
