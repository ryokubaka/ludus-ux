# LUX vs Ludus — which API?

| Task | Prefer | Notes |
|------|--------|-------|
| Get Ludus version | Ludus `GET /` (`getVersion`) | Quote tool `data` only — never invent; not LUX app version |
| Range status / VM list | Ludus `GET /range` | Pass range context when multi-range |
| Read/write range-config YAML | Ludus `/range/config` | Or LUX UI Configuration page |
| Deploy / abort / tags / limit / only-roles | Ludus `/range/deploy`, abort | Destructive — confirm |
| **Register** template from BSL/git | **LUX** `listTemplateSources` → `addTemplates` | Files on disk only — **not** Packer. See `templates.md` |
| **Build** template (Packer → Proxmox) | **Ludus** `listTemplates` → `buildTemplates` | `POST /templates` `{ templates: [names] }`. After register or when user says “build / make usable” |
| List installed / built status | Ludus `GET /templates` (`listTemplates`) | Check `built` before claiming usable |
| Ansible roles/collections | Ludus `/ansible/*` | |
| Sources (2.2.0+) | Ludus `/sources` or LUX `/api/sources` | |
| Testing mode | Ludus `/testing/*` | LUX may run EFI preflight first |
| Snapshots | Ludus `/snapshots/*` | |
| GOAD catalog / instances / execute / tasks | **LUX** `/api/goad/*` (`getGoadCatalog`, …) | Preferred for GOAD / GOAD-Mini. See `goad.md`. Never invent lab YAML |
| Ludus GOAD-related **blueprint** | Ludus `/blueprints` + Sources | Install `goad` (or similar) first, then deploy — ask if user wanted wizard vs blueprint |
| GOAD sync network / pending network | **LUX** GOAD instance routes | Preserves `network:` + `ludus_extensions` |
| Console (VNC/SPICE) | **LUX** `/api/console/*` | |
| Users roll key / password | **LUX** `/api/users/*` (admin) | |
| Settings / AI / logo | **LUX** `/api/settings`, `/api/logo` | Admin |

When unsure: `list_lux_operations` with a keyword, then `list_ludus_operations`.

**Templates trap:** `list_lux_operations query=template` only shows **register** ops. Packer **build** is always Ludus `buildTemplates`.

**GOAD trap:** “config.yml for GOAD-mini” ≠ invent a VM. Prefer LUX `getGoadCatalog` + `/goad`, or install Ludus blueprint `goad` — **ask** which.
