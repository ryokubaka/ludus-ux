# LUX workflow playbooks (agent index)

**Before** `ask_user`, inventing options, or calling destructive APIs for a topic below:  
`search_documentation` → `read_documentation` with the **exact** `hit.path` listed here.  
Do **not** invent CLI flags, operationIds, or wizard options from memory.

| User intent | Read this path first |
|-------------|----------------------|
| GOAD / GOAD-Mini / NHA / SCCM / AD lab / “deploy GOAD” | `skills/ludus-ux/references/workflows/goad-deploy.md` |
| Template register / Packer build / “make template usable” | `skills/ludus-ux/references/templates.md` |
| Which API (LUX vs Ludus)? | `skills/ludus-ux/references/lux-vs-ludus.md` |
| LUX HTTP route map | `skills/ludus-ux/references/lux-api.md` |
| Range config YAML (generic, not GOAD) | `skills/ludus-ux/references/range-config.md` (summary) → full schema `skills/ludus/range-config/references/schema.md` |
| Range deploy / tags / abort (Ludus) | `skills/ludus-ux/references/workflows/range-deploy.md` |
| Power on / off VMs (Ludus) | `skills/ludus-ux/references/workflows/vm-power.md` |
| Sources / blueprints / ansible install | `skills/ludus-ux/references/workflows/sources-ansible.md` |
| Console VNC/SPICE | `skills/ludus-ux/references/workflows/console.md` |
| Ludus CLI deep reference | `skills/ludus/ludus-cli/SKILL.md` + `skills/ludus/ludus-cli/references/commands.md` |
| Ludus troubleshooting / known errors | `skills/ludus/troubleshooting/SKILL.md` + `skills/ludus/troubleshooting/references/common-errors.md` |
| Non-GOAD environment recipes (Elastic, DVWA, …) | `skills/ludus/environment-guide/SKILL.md` + `skills/ludus/environment-guide/references/environments.md` |
| Operator overview (humans) | `docs/workflows.md` |
| Full OpenAPI | Prefer `list_lux_operations` / `list_ludus_operations` at runtime; repo `docs/openapi.yaml` |

**Preference:** `skills/ludus-ux` for LUX flows and wizard/`ask_user` steps. `skills/ludus` (vendored [ludus-skills](https://gitlab.com/badsectorlabs/ludus-skills)) supplements underlying Ludus tech — do not let it override GOAD LUX playbooks.

## Hard rules

1. **Docs → `ask_user` (buttons) → action.** Never invent flags like `--dedicated`, fake GOAD REPL, or random template names.
2. When a playbook defines an **in-chat wizard**, drive it with sequential `ask_user` + listed APIs. Do **not** eject to `/goad` / `/range/new` and stop unless the user asks for the UI page (or the playbook says so for a narrow step).
3. After reading a playbook, use **`ask_user`** only with options the playbook allows (copy ids/labels from the doc). Never ask those choices in prose.
4. OpenAPI / `describe_*` for schemas; playbooks for **when** and **in what order** to call them.
5. GOAD ops (`executeGoad`, `listGoadInstances`, …) → **`call_lux_api` only**.
