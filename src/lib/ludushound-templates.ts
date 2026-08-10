/**
 * Parse Packer template names required by a LudusHound-generated range YAML.
 */

import yaml from "js-yaml"
import { LUDUS_DEFAULT_ROUTER_TEMPLATE } from "@/lib/ludus-router-template"

function collectTemplatesFromList(list: unknown, into: Set<string>): void {
  if (!Array.isArray(list)) return
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const tpl = (item as { template?: unknown }).template
    if (typeof tpl === "string" && tpl.trim()) into.add(tpl.trim())
  }
}

/** Extract unique `template:` values from ludus / ludus_non_domain VM lists. */
export function parseTemplatesFromLudusYaml(yamlText: string): string[] {
  const doc = yaml.load(yamlText)
  const found = new Set<string>()
  if (!doc || typeof doc !== "object") return []
  const root = doc as Record<string, unknown>
  collectTemplatesFromList(root.ludus, found)
  collectTemplatesFromList(root.ludus_non_domain, found)
  return [...found].sort()
}

export interface LudushoundTemplateRequirements {
  /** All templates that must be Packer-built before deploy. */
  required: string[]
  fromYaml: string[]
  router: string
}

export function buildLudushoundRequiredTemplates(opts: {
  yamlText?: string
}): LudushoundTemplateRequirements {
  const fromYaml = opts.yamlText ? parseTemplatesFromLudusYaml(opts.yamlText) : []
  const required = new Set<string>([LUDUS_DEFAULT_ROUTER_TEMPLATE, ...fromYaml])
  return {
    required: [...required].sort(),
    fromYaml,
    router: LUDUS_DEFAULT_ROUTER_TEMPLATE,
  }
}

export interface TemplateAuditSummary {
  required: string[]
  ready: boolean
  missingAbsent: string[]
  missingUnbuilt: string[]
}

/** Same semantics as GOAD wizard checkTemplates. */
export function auditTemplates(
  required: string[],
  builtNames: Set<string> | string[],
  allNames: Set<string> | string[],
): TemplateAuditSummary {
  const built = builtNames instanceof Set ? builtNames : new Set(builtNames)
  const all = allNames instanceof Set ? allNames : new Set(allNames)
  const missingAbsent: string[] = []
  const missingUnbuilt: string[] = []
  for (const name of required) {
    if (built.has(name)) continue
    if (all.has(name)) missingUnbuilt.push(name)
    else missingAbsent.push(name)
  }
  return {
    required: [...required],
    ready: missingAbsent.length === 0 && missingUnbuilt.length === 0,
    missingAbsent,
    missingUnbuilt,
  }
}
