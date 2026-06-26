import yaml from "js-yaml"
import { injectNetworkRules, type NetworkRule } from "@/lib/network-rules"

/** Merge GOAD preview YAML with wizard network rules for review/deploy. */
export function mergeGoadPreviewWithNetworkRules(
  previewYaml: string,
  networkRules: NetworkRule[],
): string {
  if (networkRules.length === 0) return previewYaml
  return injectNetworkRules(previewYaml, networkRules)
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
