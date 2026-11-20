import { isGoadCatalogName } from "@/lib/goad/goad-wizard-args"
import { extractNetworkSection, injectNetworkRules, mergeNetworkSection, type NetworkRule, type VlanValue } from "@/lib/range/network-rules"
import { validateRules, type RangeRuleDraft } from "@/lib/luxai/range-vms"

export function catalogLabName(kind: string, labs: ReadonlyArray<{ name: string }>): string | null {
  const lab = labs.find((item) => item.name === kind)
  if (!lab || !isGoadCatalogName(lab.name)) return null
  return lab.name
}

export function catalogExtensions(selected: readonly string[], allowed: ReadonlySet<string>): string[] {
  return selected.filter((name) => allowed.has(name) && isGoadCatalogName(name))
}

function vlanValue(value: string): VlanValue {
  if (value === "wireguard" || value === "public" || value === "all") return value
  return Number(value)
}

/** Drafts the form already validated, in the shape Ludus stores on network.rules. */
export function networkRulesFromDrafts(rules: RangeRuleDraft[]): NetworkRule[] {
  const problem = validateRules(rules)
  if (problem) throw new Error(problem)
  return rules.map((rule) => ({
    name: rule.name.trim(),
    vlan_src: vlanValue(rule.vlanSrc.trim()),
    vlan_dst: vlanValue(rule.vlanDst.trim()),
    protocol: rule.protocol as NetworkRule["protocol"],
    ports: rule.protocol === "all" ? "all" : rule.ports.trim(),
    action: rule.action as NetworkRule["action"],
    ...(rule.ipLastOctetSrc?.trim() ? { ip_last_octet_src: rule.ipLastOctetSrc.trim() } : {}),
    ...(rule.ipLastOctetDst?.trim() ? { ip_last_octet_dst: rule.ipLastOctetDst.trim() } : {}),
  }))
}

export function goadRulesYaml(rules: RangeRuleDraft[]): string {
  if (rules.length === 0) return ""
  return injectNetworkRules("", networkRulesFromDrafts(rules))
}

/** Network section the post-install workflow merges back after GOAD rewrites the config. */
export function goadRulesSnapshotJson(rules: RangeRuleDraft[]): string | null {
  if (rules.length === 0) return null
  const section = extractNetworkSection(goadRulesYaml(rules))
  return section ? JSON.stringify(section) : null
}

/** Keep the range's other config. A new range has no YAML yet, so the rules are the whole file. */
export function configWithGoadRules(liveYaml: string, rules: RangeRuleDraft[]): string {
  const rulesYaml = goadRulesYaml(rules)
  if (!liveYaml.trim()) return rulesYaml
  const section = extractNetworkSection(rulesYaml)
  if (!section) return rulesYaml
  return mergeNetworkSection(liveYaml, section)
}
