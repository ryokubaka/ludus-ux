import yaml from "js-yaml"
import {
  extractNetworkRules,
  extractNetworkSection,
  injectNetworkRules,
  mergeNetworkSection,
  type NetworkRule,
} from "@/lib/network-rules"

function ruleName(rule: NetworkRule): string {
  return rule.name.trim()
}

/**
 * Rules for the GOAD wizard Network Rules step.
 * Existing range rules stay first, then rules written in the lab and extension
 * templates, then rules the user added that are not already in that list.
 */
export function combineWizardNetworkRules(
  existingRangeYaml: string | null | undefined,
  previewYaml: string,
  userRules: NetworkRule[],
): NetworkRule[] {
  const existing = existingRangeYaml ? extractNetworkRules(existingRangeYaml) : []
  const fromTemplates = extractNetworkRules(previewYaml, { fileOrder: true })
  const combined: NetworkRule[] = []
  const seen = new Set<string>()
  for (const rule of [...existing, ...fromTemplates, ...userRules]) {
    const name = ruleName(rule)
    if (name && seen.has(name)) continue
    if (name) seen.add(name)
    combined.push(rule)
  }
  return combined
}

/**
 * Rules shown in the generated configuration and copied onto the range at
 * `ludus range config set`.
 *
 * The list is the existing range, then lab and extension rules, then any
 * rules still only present in `networkRules`. Non-rule network settings on
 * the existing range, such as inter_vlan_default, stay.
 */
export function mergeGoadPreviewWithNetworkRules(
  previewYaml: string,
  networkRules: NetworkRule[],
  existingRangeYaml?: string | null,
  options?: { rulesAreComplete?: boolean },
): string {
  // Once the Network Rules step has loaded, its list is the generated config.
  // Before that, fill from the existing range and the rendered templates.
  const rules = options?.rulesAreComplete
    ? networkRules
    : combineWizardNetworkRules(existingRangeYaml, previewYaml, networkRules)
  let yamlText = previewYaml
  const existing = existingRangeYaml ? extractNetworkSection(existingRangeYaml) : null
  if (existing) {
    const { rules: _ignored, ...rest } = existing
    if (Object.keys(rest).length > 0) {
      yamlText = mergeNetworkSection(yamlText, { ...rest, rules: [] })
    }
  }
  if (rules.length === 0) {
    if (!options?.rulesAreComplete) return yamlText
    return injectNetworkRules(yamlText, [], { emptyRules: "keep" })
  }
  return injectNetworkRules(yamlText, rules)
}

export function validateGoadConfigYaml(yamlText: string): { valid: boolean; error?: string } {
  if (!yamlText.trim()) {
    return { valid: false, error: "Configuration YAML is empty" }
  }
  try {
    const doc = yaml.load(yamlText)
    if (doc === null || doc === undefined) {
      return { valid: false, error: "Configuration YAML is empty" }
    }
    if (typeof doc !== "object") {
      return { valid: false, error: "Configuration root must be a YAML mapping" }
    }
    return { valid: true }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}
