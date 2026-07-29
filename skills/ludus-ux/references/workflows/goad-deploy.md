# Workflow: Deploy a GOAD lab (LUX)

**Canonical playbook.** Read this before any GOAD `ask_user` or API call.  
Human overview: `docs/workflows.md`. Short routing: `references/goad.md`.

**Server tracks answered `ask_user` ids** (path → extensions → range → rangeID/existing → network → …).  
Do **not** re-ask a step already answered. After `range=new`, next card **must** be `rangeID` text — never extensions again.

## Forbidden (hallucinations)

| Invented | Reality |
|----------|---------|
| `--dedicated` in GOAD `args` | Dedicated range = LUX **`createRange`**, then **`executeGoad.body.rangeId`**. |
| Lab names as “extensions” (`GOAD`, `GOAD-Mini`) | Those are **lab types** from catalog `labNames`. Extensions = `extensionNames` (e.g. `exchange`, `elk`) or **None**. |
| `{ "labName": "GOAD-Mini" }` / `body.args` as **array** | `body.args` = one CLI **string**. |
| `createRange` with `extensions` / `networkConfig` / missing `rangeID` | Body is **only** `{ rangeID, name, description? }`. |
| `call_ludus_api` for GOAD ops | **`call_lux_api` only**. |
| `labs[0]` | Match lab **by name**. |
| Mega card with lab + path + confirm | Path alone first; then **bundle** extensions+range+network; follow-ups (`rangeID`, `network_yaml`, confirm) stay separate. |
| Tiny extensions list (`None` + one name) | Options = **full** catalog `extensionNames` + leading **None**. LUX merges the catalog if the model truncates. |
| Eject to `/goad` and stop | Only if the user asks for the UI page. |

## Agent sequence

### 0. Docs gate

`search_documentation` → `read_documentation`  
`path` = `skills/ludus-ux/references/workflows/goad-deploy.md` (this file).

### 1. FIRST — path (`ask_user`, one question)

```json
{
  "title": "GOAD deploy path",
  "message": "How should we deploy this GOAD lab?",
  "questions": [
    {
      "id": "path",
      "prompt": "Deploy via which integration?",
      "type": "single",
      "options": [
        { "id": "lux_goad", "label": "LUX GOAD integration (catalog + executeGoad) — recommended" },
        { "id": "ludus_blueprint", "label": "Ludus blueprint goad (badsectorlabs / ludus-source-bsl)" }
      ]
    }
  ]
}
```

Stop and wait.

---

## Branch A — `lux_goad` (in-chat wizard)

**Preferred UX:** After path (+ optional lab), show **one bundled** `ask_user` with **extensions + range + network**. Then separate cards for follow-ups (`rangeID` if new, `network_yaml` if custom, confirm).

Never combine **lab** or **path** or **confirm** into that bundle. Never invent rangeID / skip range mode.

### A1. Lab type (catalog)

```
call_lux_api  operationId=getGoadCatalog
```

- If user already named a lab (e.g. “GOAD-Mini”) → match `labNames` — **do not** re-ask as “extensions”.
- If unclear → `ask_user` **lab** (single), options = catalog `labNames` only (GOAD, GOAD-Mini, NHA, …).

### A2. PHASE 1 — templates + ansible

Use matched lab’s `templateAudit` (always includes **`debian-11-x64-server-template`** — Ludus router, required for every range). Never rebuild `built[]`. Fix `needBuild` / `missing` only. Then GET `/ansible`. **Block deploy until router + lab templates ready.**

### A3. Bundled choices (`ask_user`) — preferred

One card, three questions:

```json
{
  "title": "Deploy GOAD",
  "message": "Choose extensions, range mode, and networking.",
  "questions": [
    {
      "id": "extensions",
      "prompt": "Optional GOAD extensions (not lab types). Pick any, or None.",
      "type": "multi",
      "allowCustom": false,
      "options": [{ "id": "none", "label": "None" }]
    },
    {
      "id": "range",
      "prompt": "Create a new dedicated Ludus range, or use an existing one?",
      "type": "single",
      "options": [
        { "id": "new", "label": "Create a new range" },
        { "id": "existing", "label": "Use an existing range" }
      ]
    },
    {
      "id": "network",
      "prompt": "Skip custom networking?",
      "type": "single",
      "options": [
        { "id": "skip", "label": "Skip custom networking" },
        { "id": "custom", "label": "Provide custom network configuration" }
      ]
    }
  ]
}
```

Add **all** catalog **`extensionNames`** to the extensions options (`exchange`, `elk`, `smoke-ci`, …). **Always** put `{ "id": "none", "label": "None" }` first. Never put `GOAD` / `GOAD-Mini` here. If you omit names, LUX fills them from `getGoadCatalog`.

Sequential one-question cards for the same three steps are allowed but **not preferred**.

#### A3a. If `range=new` → **must** ask for id/name (separate card)

```json
{
  "title": "New Ludus range name",
  "message": "Enter the Ludus range ID. This is also the display name (usually the same string). Suggested pattern: <username>-GOAD-Mini-<4chars> e.g. alice-GOAD-Mini-LDQ8. This is NOT the GOAD deploy path (lux_goad vs blueprint).",
  "questions": [
    {
      "id": "rangeID",
      "prompt": "Ludus range ID (this is the range name — e.g. alice-GOAD-Mini-LDQ8)",
      "type": "text",
      "required": true
    }
  ]
}
```

Do **not** call this “path”. Do **not** call `createRange` until you have this string.

#### A3b. If `range=existing` → ask for existing range id (text or list ranges).

#### A3c. If `network=custom` → **must** collect rules (separate card)

```json
{
  "title": "Custom network rules",
  "message": "Paste a Ludus `network:` YAML block (rules with vlan_src/vlan_dst/protocol/ports/action), or write a short description of the rules you want. Do not invent if unsure — say skip.",
  "questions": [
    {
      "id": "network_yaml",
      "prompt": "network: YAML or rule description",
      "type": "text",
      "required": true
    }
  ]
}
```

Apply later via range config / GOAD handoff — **not** via `createRange` body.

### A4. Confirm (`ask_user`)

Summarize: **lab**, extensions, **rangeID**, network skip/custom. Options: `deploy` / `cancel`.

### A5. Execute

#### 1) Create Ludus range (current user)

```
call_lux_api  operationId=createRange
body: {
  "rangeID": "<from A3a>",
  "name": "<same as rangeID>",
  "description": "Dedicated Ludus range for <LabName> instance"
}
```

**Only those fields.** No `extensions`, no `networkConfig`.

#### 2) Run GOAD on that range

`body.args` must be the **same CLI string `/goad/new` builds** — never wizard JSON.

```
call_lux_api  operationId=executeGoad
body: {
  "args": "--repl \"unload;set_lab GOAD-Mini;set_provider ludus;set_provisioning_method local;set_extensions smoke-ci;create_empty;provide;prepare_jumpbox;provision_lab;provision_extension smoke-ci\"",
  "rangeId": "<same rangeID>"
}
```

| Case | `body.args` (exact pattern from LUX UI) |
|------|------------------------------------------|
| Fresh, **no** extensions | `-l '<ExactLabName>' -p ludus -m local -t install` |
| Fresh **+** extensions | `--repl "unload;set_lab <Lab>;set_provider ludus;set_provisioning_method local;set_extensions <exts space-joined>;create_empty;provide;prepare_jumpbox;provision_lab;provision_extension <each>"` |

**Never concatenate both rows** (e.g. `-l … -t install --repl "…"`). GOAD then fails with `unrecognized arguments: --repl …`.

When `range=existing`: **do not** call `createRange` — only `executeGoad` with `body.rangeId` = the existing range ID.

Example with one extension (`smoke-ci` on `GOAD-Smoke`):

```
--repl "unload;set_lab GOAD-Smoke;set_provider ludus;set_provisioning_method local;set_extensions smoke-ci;create_empty;provide;prepare_jumpbox;provision_lab;provision_extension smoke-ci"
```

- `set_extensions` = space-separated names  
- one `provision_extension <name>` per extension (`;`-separated)  
- `rangeId` is a **sibling** field — never inside `args`  
- Forbidden: `{"goadType":…,"extensions":…}` or `goadType:lux_goad extensions:[…]` as args

If custom network YAML was collected: after `createRange`, apply with Ludus/LUX range config APIs (`setRangeConfig` / handoff) before or with deploy — never stuff into `createRange`.

**Server linkage:** `executeGoad` with `body.rangeId` automatically registers the deploy handoff, polls for the new GOAD workspace, writes the range↔instance map (Dashboard **GOAD Instance** button), chowns the workspace to the current user, and refreshes range ownership. Do not skip `rangeId`.

---

## Branch B — `ludus_blueprint`

Install `goad` / `ludus-source-bsl/goad` → `workflows/range-deploy.md`. No `executeGoad`.

## Checklist

- [ ] Path `ask_user` first
- [ ] Lab from user text / `labNames` — **not** mislabeled as extensions
- [ ] PHASE 1 templates ready
- [ ] Preferred: **one card** extensions + range + network (full `extensionNames` + None)
- [ ] Follow-ups: **rangeID if new** → **YAML if custom** → confirm
- [ ] `createRange` = `{ rangeID, name, description? }` then `executeGoad` with string `args` + `rangeId`
