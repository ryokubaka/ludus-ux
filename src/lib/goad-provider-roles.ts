/**
 * TS mirror of the GOAD catalog `extract_roles_from_yaml_file` parser
 * (embedded Python in `goad-ssh.ts`). The Python runs on the GOAD host where
 * PyYAML may be absent, so this mirror exists purely as a unit-testable guard
 * for the parsing rules: `roles:` block lists, inline `[a, b]` lists, and dict
 * refs (`role:` / `name:` / `src:`).
 */
import yaml from "js-yaml"

function addRef(item: unknown, out: Set<string>): void {
  if (typeof item === "string") {
    const v = item.trim()
    if (v) out.add(v)
    return
  }
  if (item && typeof item === "object") {
    const rec = item as Record<string, unknown>
    const ref = rec.role ?? rec.name ?? rec.src
    if (typeof ref === "string" && ref.trim()) out.add(ref.trim())
  }
}

function walk(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out)
    return
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "roles" && Array.isArray(value)) {
        for (const item of value) addRef(item, out)
      } else {
        walk(value, out)
      }
    }
  }
}

/** Extract Ansible role references from Ludus provider YAML (sorted, deduped). */
export function extractRolesFromProviderYaml(yamlText: string): string[] {
  const out = new Set<string>()
  try {
    for (const doc of yaml.loadAll(yamlText)) walk(doc, out)
  } catch {
    return []
  }
  return [...out].sort((a, b) => a.localeCompare(b))
}
