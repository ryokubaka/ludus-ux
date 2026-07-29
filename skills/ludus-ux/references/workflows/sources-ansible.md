# Workflow: Sources, blueprints, Ansible

## Prefer UI

- Sources: `/sources`
- Blueprints: `/blueprints`
- Ansible roles/collections: `/ansible`

## Agent notes

1. **Sources** (Ludus 2.2+): register git/url sources, sync, install blueprints/templates/roles/collections from a source.
2. **Template files from source** → still LUX `addTemplates` for Packer file register; Packer **build** is Ludus (`templates.md`).
3. **Blueprints**: install from Sources, then apply via New Range / config — do not invent full blueprint YAML.
4. Prefer `list_ludus_operations` query=`source|blueprint|ansible` and `describe_*` before calling.
5. **GOAD deploy:** Ansible check is part of PHASE 1 in `workflows/goad-deploy.md` (GET `/ansible` + template audit) — do not skip straight to Packer/deploy.

## GOAD blueprint vs LUX GOAD

- LUX GOAD wizard (`/goad`) = preferred for GOAD-Mini etc. → `workflows/goad-deploy.md`
- Ludus blueprint named `goad` = alternate YAML path — **ask** which the user wants
