# GOAD in Ludus UX (routing)

**Full playbook:** `skills/ludus-ux/references/workflows/goad-deploy.md`

## Two paths — `ask_user` first

| Path id | How |
|---------|-----|
| **`lux_goad`** | Sequential in-chat wizard → `createRange` `{rangeID,name}` → `executeGoad` `{args,rangeId}` |
| **`ludus_blueprint`** | Install `goad` blueprint → `workflows/range-deploy.md` |

## Lab vs extensions (critical)

| Concept | Source | Examples |
|---------|--------|----------|
| **Lab type** | catalog `labNames` | GOAD, GOAD-Mini, NHA, SCCM |
| **Extensions** | catalog `extensionNames` | exchange, elk, wazuh — or **None** |

Never put lab names in the extensions question.

## Sequential wizard (`lux_goad`)

1. Path buttons  
2. Match lab (user text or lab picker) + PHASE 1 templates  
3. Extensions (multi from `extensionNames` + None)  
4. Range new/existing → if **new**, ask **rangeID** text (`<user>-GOAD-Mini-<id>`)  
5. Network skip/custom → if **custom**, ask network YAML/text  
6. Confirm → `createRange` then `executeGoad`

## createRange body (only)

```json
{ "rangeID": "alice-GOAD-Mini-LDQ8", "name": "alice-GOAD-Mini-LDQ8", "description": "…" }
```

No `extensions`, no `networkConfig`.

## Anti-patterns

- Mega-card mixing lab + range + network
- Lab names labeled as extensions
- Skipping rangeID after “create new range”
- Skipping network details after “custom”
- Wrong `createRange` body / `call_ludus_api` for GOAD
