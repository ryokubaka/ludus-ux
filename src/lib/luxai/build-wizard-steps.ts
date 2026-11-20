export type BuildWizardStepId =
  | "type"
  | "start"
  | "range"
  | "blueprint"
  | "networks"
  | "vms"
  | "domain"
  | "extensions"
  | "rules"
  | "review"

export interface BuildWizardStep {
  id: BuildWizardStepId
  label: string
  detail: string
}

const TYPE: BuildWizardStep = {
  id: "type",
  label: "Config method",
  detail: "Choose a Ludus range or a GOAD lab. A GOAD lab deploys through GOAD on this server.",
}

const START: BuildWizardStep = {
  id: "start",
  label: "How to start",
  detail: "A blueprint starts from an existing config. From scratch is each network, VM, and rule.",
}

const RANGE: BuildWizardStep = {
  id: "range",
  label: "Select range",
  detail: "Create a range or use one you already have.",
}

const BLUEPRINT: BuildWizardStep = {
  id: "blueprint",
  label: "Choose blueprint",
  detail: "LUXAI reads this blueprint and shows the full config before anything is created.",
}

const NETWORKS: BuildWizardStep = {
  id: "networks",
  label: "Networks",
  detail: "Each VLAN is a network a VM can join. Deploy New Range uses one range VLAN. Here you can add more than one.",
}

const VMS: BuildWizardStep = {
  id: "vms",
  label: "Configure VMs",
  detail: "Hostname, role, a built template, and one of those VLANs.",
}

const DOMAIN: BuildWizardStep = {
  id: "domain",
  label: "Domain setup",
  detail: "Each primary domain controller is its own domain. A workstation stays off the domain until you join it here.",
}

const EXTENSIONS: BuildWizardStep = {
  id: "extensions",
  label: "Select extensions",
  detail: "Leave them unchecked to deploy the lab alone.",
}

const RULES: BuildWizardStep = {
  id: "rules",
  label: "Network rules",
  detail: "Evaluated top to bottom. Leave this empty and Ludus accepts inter-VLAN and external traffic.",
}

const REVIEW: BuildWizardStep = {
  id: "review",
  label: "Review",
  detail: "Check these answers, then choose create only or create and deploy. Continue only saves that choice. Nothing is created until you press Apply.",
}

/** Review does not assume "create the range only". Every other select may use its first option. */
export function chosenSelectId(
  field: { id: string; kind?: string; options?: ReadonlyArray<{ id: string }> } | undefined,
  values: Record<string, string>,
): string {
  if (!field) return ""
  const saved = values[field.id]
  if (typeof saved === "string" && saved.length > 0) return saved
  if (field.id === "action") return ""
  if (field.kind === "select") return field.options?.[0]?.id ?? ""
  return ""
}

export function reviewContinueError(hasAction: boolean, action: string | undefined): string {
  if (hasAction && !action) return "Choose create only, or create and deploy."
  return ""
}

/** Steps for a range-build question. Order follows Deploy New Range and the GOAD wizard. */
export function rangeBuildWizardSteps(input: { hasKind: boolean; kind: string; start: string }): BuildWizardStep[] {
  if (!input.hasKind) return [RANGE, EXTENSIONS, REVIEW]
  if (input.kind !== "ludus") return [TYPE, EXTENSIONS, RANGE, RULES, REVIEW]
  if (input.start === "blueprint") return [TYPE, START, RANGE, BLUEPRINT, REVIEW]
  return [TYPE, START, RANGE, NETWORKS, VMS, DOMAIN, RULES, REVIEW]
}

export function isRangeBuildChoice(choice: { fields?: Array<{ id: string }> }): boolean {
  const ids = new Set((choice.fields ?? []).map((field) => field.id))
  if (ids.has("kind")) return true
  return ids.has("rangeMode") && ids.has("extensions")
}
