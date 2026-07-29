# Ludus UX HTTP API map

Auth: session cookie (`ludus_session` or `__Host-ludus_session`) from `POST /api/auth/login`.

Admin impersonation (when active): `X-Impersonate-As`, `X-Impersonate-Apikey`.

## High-traffic routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | SSH login → session |
| GET | `/api/auth/session` | Current session |
| POST | `/api/auth/logout` | Logout |
| ALL | `/api/proxy/{path}` | Pass-through to Ludus `/api/v2/{path}` |
| GET/POST | `/api/settings` | Runtime settings (AI keys admin-only) |
| GET | `/api/logs/stream` | Range deploy SSE logs |
| POST | `/api/range/create` | Create range |
| GET/PUT | `/api/range/config` | Range config helpers |
| GET | `/api/templates/sources` | Catalog only — register helpers (`listTemplateSources`). **Not** Packer build |
| POST | `/api/templates/add` | Register/install Packer files on Ludus (`addTemplates`). Does **not** build |
| DELETE | `/api/templates/delete` | Remove registered template + disk cleanup |
| GET | `/api/console/spice`, `/api/console/vnc-info` | Console access |
| GET | `/api/goad/catalog` | Labs / extensions (`getGoadCatalog`) — source of truth for GOAD-Mini etc. |
| GET | `/api/goad/instances` | GOAD instances (`listGoadInstances`) |
| POST | `/api/goad/execute` | Run GOAD action (`executeGoad`) — destructive confirm |
| GET | `/api/goad/tasks`, `.../stream`, `.../stop` | Task control |
| POST | `/api/goad/instances/{id}/sync-network` | Inject network / ludus_extensions sidecars |
| POST | `/api/assistant/chat` | In-app AI assistant (SSE) |
| GET | `/api/assistant/models` | List LLM models |
| POST | `/api/assistant/models/pull` | Pull Ollama model |

Full OpenAPI: `docs/openapi.yaml` plus runtime catalogs (`list_lux_operations` merges every `/api/*` route). Prefer `list_lux_operations` / `list_ludus_operations` at runtime for exact operationIds.

## Ludus power (not LUX)

VM power on/off is **Ludus** `powerOnRange` / `powerOffRange` — see `workflows/vm-power.md`.
`query.rangeID` + `body.machines` (usually `["all"]`).

## Templates — register (LUX) vs Packer build (Ludus)

Full detail: `references/templates.md`.

**Register from Bad Sector Labs (LUX only):**

1. `call_lux_api` `listTemplateSources` — optional query `source=badsectorlabs`.
2. Match catalog `name` (e.g. `ubuntu-22.04-x64-server`).
3. `call_lux_api` `addTemplates` body:
   ```json
   { "templates": [{ "name": "<from row>", "path": "<from row>", "apiBase": "<from row>", "ref": "<from row>" }] }
   ```
4. Success or “already registered” → **still not usable** until Packer builds.

**Packer build (Ludus only — never LUX):**

1. `call_ludus_api` `listTemplates` — use exact `name` (may end in `-template`).
2. `call_ludus_api` `buildTemplates` body `{ "templates": ["<exact name>"] }` (`POST /templates`).
3. Optional logs: Ludus `GET /templates/logs`. Do not re-fetch template sources to “build”.

## GOAD (LUX — not invented YAML)

**Playbook:** `skills/ludus-ux/references/workflows/goad-deploy.md` (read before options/API).

1. `ask_user` path (`lux_goad` | `ludus_blueprint`).
2. `lux_goad`: lab from `labNames` (not extensions) → PHASE 1 → sequential cards (extensions from `extensionNames` → range → **rangeID if new** → network → **YAML if custom** → confirm) → `createRange` `{rangeID,name}` → `executeGoad` string `args` + `rangeId`.
3. `ludus_blueprint`: install `goad` → `workflows/range-deploy.md`.
4. Never invent lab-as-extension or stuff network into `createRange`.

