import yaml from "js-yaml"
import type { AnsibleItem } from "./types"

export type BlueprintDepKind = "role" | "collection"

export interface BlueprintRequirement {
  kind: BlueprintDepKind
  name: string
  version?: string
  /** FQCN or config reference that implied this requirement */
  referencedBy?: string
}

function reqKey(kind: BlueprintDepKind, name: string): string {
  return `${kind}:${name}`
}

export function ansibleItemName(item: AnsibleItem): string {
  return (item.name || item.Name || "").trim()
}

export function ansibleItemType(item: AnsibleItem): BlueprintDepKind {
  const t = (item.type || item.Type || "role").toLowerCase()
  return t === "collection" ? "collection" : "role"
}

/** Parse Galaxy-style requirements.yml into install targets. */
export function parseRequirementsYaml(yamlText: string | undefined | null): BlueprintRequirement[] {
  if (!yamlText?.trim()) return []
  try {
    const doc = yaml.load(yamlText) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") return []

    const out: BlueprintRequirement[] = []

    if (Array.isArray(doc.roles)) {
      for (const entry of doc.roles) {
        if (typeof entry === "string" && entry.trim()) {
          out.push({ kind: "role", name: entry.trim() })
          continue
        }
        if (entry && typeof entry === "object") {
          const o = entry as { name?: string; version?: string }
          if (o.name?.trim()) {
            out.push({
              kind: "role",
              name: o.name.trim(),
              version: o.version?.trim() || undefined,
            })
          }
        }
      }
    }

    if (Array.isArray(doc.collections)) {
      for (const entry of doc.collections) {
        if (typeof entry === "string" && entry.trim()) {
          out.push({ kind: "collection", name: entry.trim() })
          continue
        }
        if (entry && typeof entry === "object") {
          const o = entry as { name?: string; version?: string }
          if (o.name?.trim()) {
            out.push({
              kind: "collection",
              name: o.name.trim(),
              version: o.version?.trim() || undefined,
            })
          }
        }
      }
    }

    return out
  } catch {
    return []
  }
}

/** Map a range-config role reference to galaxy role and/or collection requirements. */
export function roleRefToRequirements(roleRef: string): BlueprintRequirement[] {
  const ref = roleRef.trim()
  if (!ref) return []

  const parts = ref.split(".").filter(Boolean)
  if (parts.length >= 3) {
    return [{ kind: "collection", name: `${parts[0]}.${parts[1]}`, referencedBy: ref }]
  }
  if (parts.length === 2) {
    return [{ kind: "role", name: ref, referencedBy: ref }]
  }
  return [{ kind: "role", name: ref, referencedBy: ref }]
}

function collectRoleRef(refs: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.trim()) refs.add(value.trim())
}

/** Extract Ansible role FQCNs from Ludus range-config YAML. */
export function extractConfigRoleRefs(configYaml: string): string[] {
  if (!configYaml.trim()) return []
  try {
    const doc = yaml.load(configYaml) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") return []

    const refs = new Set<string>()
    const ludus = doc.ludus
    if (!Array.isArray(ludus)) return []

    for (const vm of ludus) {
      if (!vm || typeof vm !== "object") continue
      const entry = vm as Record<string, unknown>

      if (Array.isArray(entry.roles)) {
        for (const role of entry.roles) {
          if (typeof role === "string") {
            collectRoleRef(refs, role)
          } else if (role && typeof role === "object") {
            collectRoleRef(refs, (role as { name?: string }).name)
          }
        }
      }

      if (Array.isArray(entry.depends_on)) {
        for (const dep of entry.depends_on) {
          if (dep && typeof dep === "object") {
            collectRoleRef(refs, (dep as { role?: string }).role)
          }
        }
      }
    }

    return [...refs]
  } catch {
    return []
  }
}

export function requirementsFromConfigYaml(configYaml: string): BlueprintRequirement[] {
  return extractConfigRoleRefs(configYaml).flatMap(roleRefToRequirements)
}

/** Merge requirement lists; requirements.yml wins for version when duplicate. */
export function mergeBlueprintRequirements(...lists: BlueprintRequirement[][]): BlueprintRequirement[] {
  const byKey = new Map<string, BlueprintRequirement>()

  for (const list of lists) {
    for (const req of list) {
      const key = reqKey(req.kind, req.name)
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, { ...req })
        continue
      }
      byKey.set(key, {
        ...existing,
        version: existing.version || req.version,
        referencedBy: existing.referencedBy || req.referencedBy,
      })
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "collection" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function findMissingRequirements(
  installed: AnsibleItem[],
  required: BlueprintRequirement[],
): BlueprintRequirement[] {
  const installedRoles = new Set(
    installed.filter((i) => ansibleItemType(i) === "role").map(ansibleItemName),
  )
  const installedCollections = new Set(
    installed.filter((i) => ansibleItemType(i) === "collection").map(ansibleItemName),
  )

  const missing: BlueprintRequirement[] = []
  const seen = new Set<string>()

  for (const req of required) {
    const key = reqKey(req.kind, req.name)
    if (seen.has(key)) continue
    seen.add(key)

    const isInstalled =
      req.kind === "role" ? installedRoles.has(req.name) : installedCollections.has(req.name)
    if (!isInstalled) missing.push(req)
  }

  return missing
}

export function resolveBlueprintRequirements(
  configYaml: string,
  requirementsYaml?: string | null,
): BlueprintRequirement[] {
  return mergeBlueprintRequirements(
    parseRequirementsYaml(requirementsYaml),
    requirementsFromConfigYaml(configYaml),
  )
}
