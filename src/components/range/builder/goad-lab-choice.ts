import type { GoadExtensionDef, GoadLabDef } from "@/lib/core/types"
import {
  extensionAnsibleState,
  type AnsibleInstalledSets,
} from "@/lib/goad/goad-dependency-service"
import { checkTemplates } from "@/components/goad/goad-instance-tab-utils"

export interface GoadChoiceState {
  selectable: boolean
  /** Short reason shown when the row cannot be selected. */
  reason: string | null
}

export interface GoadPickReadiness {
  builtNames: ReadonlySet<string>
  allNames: ReadonlySet<string>
  ludusVersion: string
  templatesLoading: boolean
  ansible: AnsibleInstalledSets | null
  ansibleLoading: boolean
}

function templateSets(readiness: GoadPickReadiness): { built: Set<string>; all: Set<string> } {
  return {
    built: new Set(readiness.builtNames),
    all: new Set(readiness.allNames),
  }
}

function compatibilityOf(ext: GoadExtensionDef): string[] {
  return Array.isArray(ext.compatibility)
    ? ext.compatibility.filter((name): name is string => typeof name === "string")
    : []
}

export function compatibleGoadExtensions(
  labName: string | null,
  extensions: readonly GoadExtensionDef[],
): GoadExtensionDef[] {
  if (!labName) return []
  return extensions.filter((ext) => {
    const compatibility = compatibilityOf(ext)
    return compatibility.includes("*") || compatibility.includes(labName)
  })
}

export function goadLabChoiceState(lab: GoadLabDef, readiness: GoadPickReadiness): GoadChoiceState {
  if (readiness.templatesLoading) return { selectable: false, reason: "Checking templates" }
  if (lab.ludusSupported === false) return { selectable: false, reason: "No Ludus provider" }
  const { built, all } = templateSets(readiness)
  const required = Array.isArray(lab.requiredTemplates) ? lab.requiredTemplates : []
  const templates = checkTemplates(required, built, all, {
    ludusVersion: readiness.ludusVersion,
  })
  if (!templates.ready) return { selectable: false, reason: "Missing templates" }
  return { selectable: true, reason: null }
}

export function goadExtensionChoiceState(
  ext: GoadExtensionDef,
  readiness: GoadPickReadiness,
): GoadChoiceState {
  if (readiness.templatesLoading) return { selectable: false, reason: "Checking templates" }
  const { built, all } = templateSets(readiness)
  const required = Array.isArray(ext.requiredTemplates) ? ext.requiredTemplates : []
  const templates = checkTemplates(required, built, all, {
    ludusVersion: readiness.ludusVersion,
  })
  if (!templates.ready) return { selectable: false, reason: "Missing templates" }
  const ansible = extensionAnsibleState(ext, readiness.ansible, readiness.ansibleLoading)
  if (ansible === "unknown") return { selectable: false, reason: "Checking Ansible" }
  if (ansible === "missing") return { selectable: false, reason: "Missing Ansible" }
  return { selectable: true, reason: null }
}

export function goadPickCanDeploy(args: {
  lab: GoadLabDef | null
  selectedExtensions: readonly string[]
  extensions: readonly GoadExtensionDef[]
  readiness: GoadPickReadiness
}): { ok: boolean; reason: string | null } {
  if (args.readiness.templatesLoading) return { ok: false, reason: "Templates are still loading." }
  if (!args.lab) return { ok: false, reason: "Select a GOAD lab on the left." }
  const labState = goadLabChoiceState(args.lab, args.readiness)
  if (!labState.selectable) return { ok: false, reason: `${args.lab.name} is not ready to deploy.` }
  const compatible = compatibleGoadExtensions(args.lab.name, args.extensions)
  for (const name of args.selectedExtensions) {
    const ext = compatible.find((item) => item.name === name)
    if (!ext) return { ok: false, reason: `${name} does not install into ${args.lab.name}.` }
    const state = goadExtensionChoiceState(ext, args.readiness)
    if (!state.selectable) return { ok: false, reason: `${name} is not ready to install.` }
  }
  return { ok: true, reason: null }
}
