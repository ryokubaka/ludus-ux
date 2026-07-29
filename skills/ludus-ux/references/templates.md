# Templates — register vs Packer build

These are **two different steps**. Mixing them up is a common failure.

| Step | What it does | Surface | operationId | Result |
|------|----------------|---------|-------------|--------|
| **Register / add / install from source** | Copy Packer files onto Ludus host + register name | **LUX** | `listTemplateSources` → `addTemplates` | Appears in template list as **Not Built** |
| **Build (Packer)** | Run Packer → create Proxmox template in `SHARED` | **Ludus** | `listTemplates` → `buildTemplates` | **Built** — usable in range config |

## Critical rules

1. **“Already registered” ≠ built.** Usable in ranges only after Packer succeeds.
2. User says **build / make usable / finish installing** after register → call **Ludus** `buildTemplates`. Do **not** call `listTemplateSources` again.
3. LUX has **no** Packer build endpoint. `list_lux_operations query=template` only shows register helpers.
4. Use the **exact name** from Ludus `listTemplates` (often ends in `-template`). Catalog dir names may omit it.
5. After `buildTemplates` returns success / “building started”: **do not POST again**. Tell the user to open **`/templates`** for Packer logs. Optional read-only: `getTemplateLogs` (`GET /templates/logs`).

## Recipe A — add from Bad Sector Labs, then build

1. `call_lux_api` `listTemplateSources` — query `source=badsectorlabs` (optional).
2. Pick catalog row (`name`, `path`, `apiBase`, `ref`).
3. `call_lux_api` `addTemplates` body:
   ```json
   { "templates": [{ "name": "…", "path": "…", "apiBase": "…", "ref": "…" }] }
   ```
4. Point user at `/templates` (Not Built). Then Ludus `listTemplates` → `buildTemplates` if they want it built now.
5. After build starts → `/templates` for logs. No second POST.

## Recipe B — already registered, need Packer build

1. `call_ludus_api` `listTemplates`
2. `call_ludus_api` `buildTemplates` with `{ "templates": ["…"] }`
3. Tell user: open **Templates** (`/templates`) to monitor. Optional one log peek. Stop.

## Endpoints (quick)

| Action | Tool | Path |
|--------|------|------|
| List catalog | `call_lux_api` `listTemplateSources` | `GET /api/templates/sources` |
| Register | `call_lux_api` `addTemplates` | `POST /api/templates/add` |
| Delete registered | `call_lux_api` (if present) / Templates UI | `DELETE /api/templates/delete` |
| List registered | `call_ludus_api` `listTemplates` | `GET /templates` |
| Packer build | `call_ludus_api` `buildTemplates` | `POST /templates` body `{ templates: [names] }` |
| Abort build | Ludus | `POST /templates/abort` |
| Build logs | `call_ludus_api` `getTemplateLogs` | `GET /templates/logs` |
| Monitor UI | — | LUX page **`/templates`** |

Never invent Ludus ids like `addTemplateFromSource`. Never invent LUX ids like `buildTemplate`.
