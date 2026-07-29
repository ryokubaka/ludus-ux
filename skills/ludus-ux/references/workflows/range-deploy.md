# Workflow: Range deploy (Ludus)

**Canonical playbook** for non-GOAD Ludus range create/config/deploy.  
GOAD labs → `workflows/goad-deploy.md` first (may hand off here for `ludus_blueprint`).

**Server tracks answered `ask_user` ids** — do not re-ask completed steps; call the next unanswered card only.

## Forbidden

- Inventing deploy tags / full range YAML from memory
- Deploying without a known range id
- Deploying when `debian-11-x64-server-template` is not Packer-built (Ludus router — required for every range)
- Prose forks for path/config method — use **`ask_user`** buttons
- Mixing GOAD `executeGoad` into this flow unless the user asked for range-only work after a blueprint install
- Re-POSTing `deployRange` after kickoff

## Agent sequence (in-chat wizard)

### 0. Docs gate

`search_documentation` → `read_documentation`  
`path` = `skills/ludus-ux/references/workflows/range-deploy.md` (this file).

### 1. Path (`ask_user`)

```json
{
  "title": "Range deploy",
  "message": "How should we proceed?",
  "questions": [
    {
      "id": "path",
      "prompt": "Range action?",
      "type": "single",
      "options": [
        { "id": "new", "label": "Create a new Ludus range" },
        { "id": "existing", "label": "Deploy / update an existing range" }
      ]
    }
  ]
}
```

Stop and wait. If `existing` and range unknown → ask for range id (selected UI range, or list via Ludus).

### 2. Config method (`ask_user`) — mirrors `/range/new`

```json
{
  "title": "Config method",
  "message": "How should the range config be supplied?",
  "questions": [
    {
      "id": "method",
      "prompt": "Config method?",
      "type": "single",
      "options": [
        { "id": "wizard", "label": "Guided VM / domain setup (high-level; no invented YAML)" },
        { "id": "yaml", "label": "I will provide / paste range config YAML" },
        { "id": "blueprint", "label": "Apply an installed Ludus blueprint" }
      ]
    }
  ]
}
```

### 3. Branch

#### `blueprint`

- `ask_user` or list installed blueprints; prefer exact id (e.g. `goad`, `ludus-source-bsl/goad`).
- If missing → Sources install (`workflows/sources-ansible.md`), then continue.
- Apply blueprint to the target range (Ludus/LUX ops from `list_*` / `describe_*` — do not invent).

#### `yaml`

- Ask user for YAML (chat text) or confirm using current `getRangeConfig`.
- Validate schema hint: `# yaml-language-server: $schema=https://docs.ludus.cloud/schemas/range-config.json`
- Never invent a full lab YAML (Elastic/GOAD/etc.) from memory.

#### `wizard`

- Collect high-level intent via `ask_user` / short chat (VM count, OS templates that **exist** from `listTemplates` built only).
- Prefer pointing at `/range/new` for the full VM editor **only if** the user needs complex multi-VM YAML you cannot safely author — otherwise stay playbook-bound and do not invent hostnames/IPs.

### 4. Confirm (`ask_user`)

Summarize range id + method. Confirm deploy vs cancel.

### 5. Execute

1. If `path=new`: create range via LUX `createRange` or Ludus create (per OpenAPI) with agreed `rangeID` / name / description.
2. `call_ludus_api` `getRange` — know state.
3. Config: `getRangeConfig` → `setRangeConfig` (destructive confirm) when YAML/blueprint result is ready.
4. `deployRange` — optional tags / only-roles only from Ludus OpenAPI / user choice.
5. After deploy **starts**: **do not** re-POST. Point user at **`/range`** for logs. Optional read-only log peek.

## Prefer watch UI (after kickoff)

- Status / logs: `/range`
- Config YAML page: `/range/config`
- Full visual new-range editor: `/range/new` (only when user wants the page, or wizard branch is too complex)

## Related

- GOAD: `workflows/goad-deploy.md`
- YAML schema: `range-config.md`
- Blueprints / Sources: `workflows/sources-ansible.md`
