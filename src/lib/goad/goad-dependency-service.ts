import {
  ansibleRequirementsOnly,
  findMissingRequirements,
  findMissingTemplateRequirements,
  mergeBlueprintRequirements,
  requirementsFromConfigYaml,
  roleRefToRequirements,
  type BlueprintRequirement,
} from "@/lib/blueprints/blueprint-dependencies"
import {
  fetchInstalledAnsible,
  findMissingFromInstalled,
  installMissingAnsibleRequirements,
  type InstallAnsibleRequirementsResult,
} from "@/lib/ansible/ansible-requirements-service"
import { ludusApi } from "@/lib/ui/api"
import { extractArray } from "@/lib/core/utils"
import type { AnsibleItem, TemplateObject } from "@/lib/core/types"

export interface AnsibleInstalledSets {
  roles: Set<string>
  collections: Set<string>
}

export function parseAnsibleInstalledSets(items: AnsibleItem[]): AnsibleInstalledSets {
  const roles = new Set<string>()
  const collections = new Set<string>()
  for (const item of items) {
    const name = (item.name || item.Name || "").trim()
    if (!name) continue
    const kind = (item.type || item.Type || "role").toLowerCase()
    if (kind === "collection") collections.add(name)
    else roles.add(name)
  }
  return { roles, collections }
}

function asNameSet(value: unknown): Set<string> | null {
  if (value instanceof Set) return value as Set<string>
  if (!Array.isArray(value)) return null
  return new Set(value.filter((item): item is string => typeof item === "string"))
}

/**
 * Sets do not survive the query cache. A reload restores `{}`, and calling
 * `.has` on that object crashes the lab picker. Arrays and live Sets are valid.
 */
export function coerceAnsibleInstalledSets(value: unknown): AnsibleInstalledSets | null {
  if (!value || typeof value !== "object") return null
  const rec = value as { roles?: unknown; collections?: unknown }
  const roles = asNameSet(rec.roles)
  const collections = asNameSet(rec.collections)
  if (!roles || !collections) return null
  return { roles, collections }
}

/** Names the query cache can store. `JSON.stringify` turns a Set into `{}`. */
export function serializableAnsibleInstalled(sets: AnsibleInstalledSets): {
  roles: string[]
  collections: string[]
} {
  return { roles: [...sets.roles], collections: [...sets.collections] }
}

/** Missing galaxy role/collection names for an extension catalog entry. */
export function extensionMissingAnsibleRoles(
  ext: { requiredRoles?: string[] },
  ansibleInstalled: AnsibleInstalledSets | null,
): string[] {
  const refs = Array.isArray(ext.requiredRoles)
    ? ext.requiredRoles.filter((ref): ref is string => typeof ref === "string")
    : []
  const installed = coerceAnsibleInstalledSets(ansibleInstalled)
  if (refs.length === 0 || !installed) return []
  const missing: string[] = []
  for (const ref of refs) {
    for (const req of roleRefToRequirements(ref)) {
      const names = req.kind === "role" ? installed.roles : installed.collections
      if (!names.has(req.name)) missing.push(req.name)
    }
  }
  return [...new Set(missing)]
}

export function extensionAnsibleDepsReady(
  ext: { requiredRoles?: string[] },
  ansibleInstalled: AnsibleInstalledSets | null,
): boolean {
  const refs = Array.isArray(ext.requiredRoles) ? ext.requiredRoles : []
  if (refs.length === 0) return true
  if (!coerceAnsibleInstalledSets(ansibleInstalled)) return false
  return extensionMissingAnsibleRoles(ext, ansibleInstalled).length === 0
}

export type ExtensionAnsibleState = "ready" | "missing" | "unknown"

/**
 * Tri-state for an extension's Ansible readiness so UI can distinguish
 * "not yet known / still loading" from a confirmed "missing" — avoids showing a
 * disabled button with no explanation (or an empty "Missing Ansible:" tooltip).
 */
export function extensionAnsibleState(
  ext: { requiredRoles?: string[] },
  ansibleInstalled: AnsibleInstalledSets | null,
  loading = false,
): ExtensionAnsibleState {
  const refs = Array.isArray(ext.requiredRoles) ? ext.requiredRoles : []
  if (refs.length === 0) return "ready"
  if (loading || !coerceAnsibleInstalledSets(ansibleInstalled)) return "unknown"
  return extensionMissingAnsibleRoles(ext, ansibleInstalled).length === 0 ? "ready" : "missing"
}

/** Add a name to an in-flight set without mutating the input (React-safe). */
export function withInstalling(current: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(current)
  next.add(name)
  return next
}

/** Remove only the given name from an in-flight set (clears own spinner, not others'). */
export function withoutInstalling(current: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(current)
  next.delete(name)
  return next
}

export interface GoadDependencyCheck {
  required: BlueprintRequirement[]
  missing: BlueprintRequirement[]
  ready: boolean
}

export function requirementsFromExtensionRoleRefs(roleRefs: string[]): BlueprintRequirement[] {
  return mergeBlueprintRequirements(...roleRefs.map((ref) => roleRefToRequirements(ref)))
}

function parseTemplateList(data: unknown): TemplateObject[] {
  return extractArray<TemplateObject>(data)
}

/** Compare GOAD preview/review config YAML against installed Ansible + built templates. */
export async function checkGoadDeployDependencies(
  configYaml: string,
): Promise<GoadDependencyCheck> {
  if (!configYaml.trim()) {
    return { required: [], missing: [], ready: true }
  }

  const [installed, templatesRes, required] = await Promise.all([
    fetchInstalledAnsible(),
    ludusApi.listTemplates(),
    Promise.resolve(requirementsFromConfigYaml(configYaml)),
  ])
  if (templatesRes.error) throw new Error(templatesRes.error)

  const templates = parseTemplateList(templatesRes.data)
  const missingAnsible = findMissingRequirements(installed, ansibleRequirementsOnly(required))
  const missingTemplates = findMissingTemplateRequirements(required, templates)
  const missing = [...missingAnsible, ...missingTemplates]

  return {
    required,
    missing,
    ready: missing.length === 0,
  }
}

/** Check extension catalog role refs against installed Ansible (step 1 gate). */
export async function checkExtensionAnsibleReady(
  roleRefs: string[] | undefined,
  installed?: AnsibleItem[],
): Promise<{ ready: boolean; missing: BlueprintRequirement[] }> {
  const refs = roleRefs ?? []
  if (refs.length === 0) return { ready: true, missing: [] }

  const required = requirementsFromExtensionRoleRefs(refs)
  const ansibleInstalled = installed ?? (await fetchInstalledAnsible())
  const missing = findMissingFromInstalled(ansibleInstalled, required)
  return { ready: missing.length === 0, missing }
}

export async function installGoadDependencies(
  missing: BlueprintRequirement[],
): Promise<InstallAnsibleRequirementsResult> {
  if (missing.length === 0) {
    return { ok: true, installed: [], failed: [] }
  }
  return installMissingAnsibleRequirements(missing)
}

export async function refreshGoadDependencyCheck(
  configYaml: string,
): Promise<GoadDependencyCheck> {
  return checkGoadDeployDependencies(configYaml)
}
