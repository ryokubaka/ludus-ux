# Upstream Ludus skills (supplement)

Vendored from [badsectorlabs/ludus-skills](https://gitlab.com/badsectorlabs/ludus-skills) (MIT — see `LICENSE`).

## Role in Ludus UX

| Skill tree | Role |
|------------|------|
| **`skills/ludus-ux/`** | **Preferred** for LUX assistant routing, GOAD/LUX wizards, `ask_user` playbooks, LUX vs Ludus APIs |
| **`skills/ludus/`** (this tree) | **Supplement** — deep Ludus platform knowledge (range YAML schema, CLI, troubleshooting, environment recipes) |

When both apply: follow **ludus-ux** playbooks for *what to do in LUX*; use these skills via `search_documentation` / `read_documentation` for *underlying Ludus tech* (schema fields, CLI flags, error catalogs, non-GOAD environment YAML).

## Contents

| Folder | Topic |
|--------|--------|
| `range-config/` | Full range YAML schema reference |
| `ludus-cli/` | Ludus CLI command reference |
| `troubleshooting/` | Known errors / fixes |
| `environment-guide/` | Pre-built environments (GOAD, Elastic, …) — for **YAML/CLI** recipes; GOAD *via LUX* still uses `ludus-ux` `workflows/goad-deploy.md` |

## Updating

```bash
git clone --depth 1 https://gitlab.com/badsectorlabs/ludus-skills.git /tmp/ludus-skills-src
rsync -a --delete /tmp/ludus-skills-src/skills/ ./skills/ludus/
cp /tmp/ludus-skills-src/LICENSE ./skills/ludus/LICENSE
# keep this README.md (do not overwrite with upstream root README)
```

Do **not** put this tree ahead of `ludus-ux` in the system prompt — it is indexed for on-demand search only.
