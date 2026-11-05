/**
 * Build GOAD REPL provision commands for lab playbook targeting.
 * Matches goad.py: provision_lab | provision <playbook> | provision_lab_from <playbook>
 */

export type GoadProvisionMode = "entire" | "single" | "from"

export function buildGoadProvisionReplCommand(
  instanceId: string,
  mode: GoadProvisionMode,
  playbook?: string,
): string {
  const id = instanceId.trim()
  if (mode === "entire") {
    return `--repl "use ${id};provision_lab"`
  }
  const pb = (playbook ?? "").trim()
  if (!pb) {
    throw new Error("Playbook is required for single / from-onward provision")
  }
  // Escape double quotes in playbook names (unlikely but safe)
  const safe = pb.replace(/"/g, "")
  if (mode === "single") {
    return `--repl "use ${id};provision ${safe}"`
  }
  return `--repl "use ${id};provision_lab_from ${safe}"`
}

export function provisionModeLabel(mode: GoadProvisionMode, playbook?: string): string {
  if (mode === "entire") return "entire lab"
  if (mode === "single") return `playbook ${playbook ?? "?"}`
  return `from ${playbook ?? "?"} onward`
}
