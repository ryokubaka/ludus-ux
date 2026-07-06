import {
  findMissingRequirements,
  mergeBlueprintRequirements,
  requirementsFromConfigYaml,
  roleRefToRequirements,
  type BlueprintRequirement,
} from "@/lib/blueprint-dependencies"
import {
  fetchInstalledAnsible,
  findMissingFromInstalled,
  installMissingAnsibleRequirements,
  type InstallAnsibleRequirementsResult,
} from "@/lib/ansible-requirements-service"
import type { AnsibleItem } from "@/lib/types"

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

/** Missing galaxy role/collection names for an extension catalog entry. */
export function extensionMissingAnsibleRoles(
  ext: { requiredRoles?: string[] },
  ansibleInstalled: AnsibleInstalledSets | null,
): string[] {
  const refs = ext.requiredRoles ?? []
  if (refs.length === 0 || !ansibleInstalled) return []
  const missing: string[] = []
  for (const ref of refs) {
    for (const req of roleRefToRequirements(ref)) {
      const installed =
        req.kind === "role" ? ansibleInstalled.roles : ansibleInstalled.collections
      if (!installed.has(req.name)) missing.push(req.name)
    }
  }
  return [...new Set(missing)]
}

export function extensionAnsibleDepsReady(
  ext: { requiredRoles?: string[] },
  ansibleInstalled: AnsibleInstalledSets | null,
): boolean {
  const refs = ext.requiredRoles ?? []
  if (refs.length === 0) return true
  if (!ansibleInstalled) return false
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
  const refs = ext.requiredRoles ?? []
  if (refs.length === 0) return "ready"
  if (loading || !ansibleInstalled) return "unknown"
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

/** Compare GOAD preview/review config YAML against installed Ansible roles/collections. */
export async function checkGoadDeployDependencies(
  configYaml: string,
): Promise<GoadDependencyCheck> {
  if (!configYaml.trim()) {
    return { required: [], missing: [], ready: true }
  }

  const [installed, required] = await Promise.all([
    fetchInstalledAnsible(),
    Promise.resolve(requirementsFromConfigYaml(configYaml)),
  ])
  const missing = findMissingRequirements(installed, required)

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
