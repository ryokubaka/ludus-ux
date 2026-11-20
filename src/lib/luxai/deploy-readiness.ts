import { checkTemplates } from "@/components/goad/goad-instance-tab-utils"
import {
  ansibleRequirementsOnly,
  findMissingRequirements,
  findMissingTemplateRequirements,
  resolveBlueprintRequirements,
} from "@/lib/blueprints/blueprint-dependencies"
import { extensionMissingAnsibleRoles } from "@/lib/goad/goad-dependency-service"
import type { AnsibleItem, TemplateObject } from "@/lib/core/types"
import { checkRouterTemplateBuilt, routerTemplateBlockMessage } from "@/lib/ludus/ludus-router-template"
import { buildLudushoundRequiredTemplates } from "@/lib/templates/ludushound-templates"

/** What this host can actually install. Sets stay on the server. */
export interface HostInventory {
  built: ReadonlySet<string>
  registered: ReadonlySet<string>
  ansibleRoles: ReadonlySet<string>
  ansibleCollections: ReadonlySet<string>
  /** False when the Ansible list could not be read. Extensions that need roles stay blocked. */
  ansibleKnown: boolean
  ludusVersion: string
}

export interface GoadInstallTarget {
  name: string
  requiredTemplates?: string[]
  requiredRoles?: string[]
  ludusSupported?: boolean
}

/** Empty when this target can be deployed. Otherwise the reason it cannot. */
export function goadInstallBlock(target: GoadInstallTarget, inventory: HostInventory): string {
  if (target.ludusSupported === false) return "No Ludus provider"
  const templates = checkTemplates(
    target.requiredTemplates ?? [],
    new Set(inventory.built),
    new Set(inventory.registered),
    { ludusVersion: inventory.ludusVersion },
  )
  if (!templates.ready) {
    const missing = [
      ...templates.missingUnbuilt.map((name) => `${name} (not built)`),
      ...templates.missingAbsent.map((name) => `${name} (not on this host)`),
    ]
    return `Missing templates: ${missing.join(", ")}`
  }
  const roles = target.requiredRoles ?? []
  if (roles.length === 0) return ""
  if (!inventory.ansibleKnown) return "Ansible roles and collections could not be read"
  const missing = extensionMissingAnsibleRoles(
    { requiredRoles: roles },
    { roles: new Set(inventory.ansibleRoles), collections: new Set(inventory.ansibleCollections) },
  )
  if (missing.length === 0) return ""
  return `Missing Ansible: ${missing.join(", ")}`
}

/** Empty when a Ludus deploy can start. Otherwise the router template is not ready. */
export function routerDeployBlock(inventory: HostInventory): string {
  const builtMap = new Map<string, boolean>()
  for (const name of inventory.registered) builtMap.set(name, inventory.built.has(name))
  const check = checkRouterTemplateBuilt(builtMap, {
    ludusVersion: inventory.ludusVersion,
    registeredTemplates: new Set(inventory.registered),
  })
  return check.ok ? "" : routerTemplateBlockMessage(check)
}

function inventoryTemplates(inventory: HostInventory): TemplateObject[] {
  return [...inventory.registered].map((name) => ({ name, built: inventory.built.has(name) }))
}

function inventoryAnsible(inventory: HostInventory): AnsibleItem[] {
  return [
    ...[...inventory.ansibleRoles].map((name) => ({ name, version: "", type: "role" as const })),
    ...[...inventory.ansibleCollections].map((name) => ({ name, version: "", type: "collection" as const })),
  ]
}

/** Empty when this blueprint's templates, router, and Ansible requirements are installed. */
export function blueprintInstallBlock(
  configYaml: string,
  requirementsYaml: string | null | undefined,
  inventory: HostInventory,
): string {
  const requiredTemplates = buildLudushoundRequiredTemplates({
    yamlText: configYaml,
    ludusVersion: inventory.ludusVersion,
    registeredTemplates: new Set(inventory.registered),
  }).required
  const missingTemplates = findMissingTemplateRequirements(
    requiredTemplates.map((name) => ({ kind: "template", name })),
    inventoryTemplates(inventory),
  )
  const ansible = ansibleRequirementsOnly(resolveBlueprintRequirements(configYaml, requirementsYaml))
  const parts: string[] = []
  if (missingTemplates.length > 0) {
    parts.push(`Missing templates: ${missingTemplates.map((req) => (
      `${req.name} (${req.templateStatus === "unbuilt" ? "not built" : "not on this host"})`
    )).join(", ")}`)
  }
  if (ansible.length > 0 && !inventory.ansibleKnown) {
    parts.push("Ansible roles and collections could not be read")
  } else if (ansible.length > 0) {
    const missingAnsible = findMissingRequirements(inventoryAnsible(inventory), ansible)
    if (missingAnsible.length > 0) parts.push(`Missing Ansible: ${missingAnsible.map((req) => req.name).join(", ")}`)
  }
  return parts.join(". ")
}
