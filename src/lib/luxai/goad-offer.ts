import { randomUUID } from "node:crypto"
import { buildGoadWizardInstallArgs, isGoadCatalogName } from "@/lib/goad/goad-wizard-args"
import { goadInstallBlock, routerDeployBlock, type HostInventory } from "@/lib/luxai/deploy-readiness"
import { catalogExtensions, catalogLabName } from "@/lib/luxai/goad-rules"
import type { RunControl } from "@/lib/luxai/agent"
import { resolveGoadDeployPlan, type GoadDeployIntent, type GoadPlanCatalog } from "@/lib/luxai/goad-plan"
import { describeRangePlan, domainJoinWarnings, parseRangeNetworks, parseRangeRules, parseRangeVms, RANGE_VM_ROLES, scratchRangeYaml, validateDomain, validateNetworks, validateRangeId, validateRangeName, validateRangeVms, validateRules, type RangeRuleDraft, type RangeTemplateChoice } from "@/lib/luxai/range-vms"
import type { LuxaiChangeView, LuxaiChoice, LuxaiStreamEvent } from "@/lib/luxai/types"

export interface GoadOfferInput {
  intent: GoadDeployIntent
  /** LUX has a GOAD install path configured. */
  configured: boolean
  /** The catalog call failed. An empty lab list is then not "no labs exist". */
  catalogError: boolean
  catalog: GoadPlanCatalog
  ranges?: Array<{ id: string; name: string }>
  blueprints?: Array<{ id: string; name: string; description?: string; block?: string }>
  templates?: RangeTemplateChoice[]
  /** Built templates, Ansible roles, and the Ludus version on this host. */
  inventory?: HostInventory | null
  /** False when this user cannot read that range. */
  rangeExists: boolean
  /** True when LUX already links a GOAD instance to the range. */
  alreadyLinked: boolean
  signal?: AbortSignal
  control?: () => RunControl | null
  takeAnswer?: () => { choiceId: string; selected: string[]; values?: Record<string, string> } | null
  clearSteer?: () => void
  onChoice?: (choice: LuxaiChoice) => void
  propose: (spec: {
    lab: string
    extensions: string[]
    rangeId: string
    args: string
    summary: string
    preview: string
    create?: { name: string; rangeId: string } | null
    rules?: RangeRuleDraft[]
    yaml?: string
    deploy?: boolean
  }) => LuxaiChangeView
  onEvent: (event: LuxaiStreamEvent) => void
}

export interface GoadOfferResult {
  text: string
  stopped: boolean
}

function rangePlanCopy(args: { existing: boolean; deploy: boolean; rangeId: string; lab?: string }): { summary: string; applyLine: string } {
  const { existing, deploy, rangeId, lab } = args
  if (lab) {
    if (!existing && deploy) return { summary: `Create ${rangeId} and deploy ${lab}`, applyLine: "Apply creates the range and starts the GOAD install." }
    if (!existing) return { summary: `Create ${rangeId} for ${lab}`, applyLine: "Apply creates the range and does not start the lab." }
    if (deploy) return { summary: `Deploy ${lab} on ${rangeId}`, applyLine: "Apply starts the GOAD install on the existing range." }
    return { summary: `Update ${rangeId} for ${lab}`, applyLine: "Apply updates the existing range and does not start the lab." }
  }
  if (!existing && deploy) return { summary: `Create ${rangeId} and deploy it`, applyLine: "Apply creates the range, uploads this config, and starts a full deploy." }
  if (!existing) return { summary: `Create ${rangeId}`, applyLine: "Apply creates the range and uploads this config. It does not deploy." }
  if (deploy) return { summary: `Deploy ${rangeId}`, applyLine: "Apply uploads this config to the existing range and starts a full deploy." }
  return { summary: `Update ${rangeId}`, applyLine: "Apply uploads this config to the existing range. It does not deploy." }
}

function installBlock(input: GoadOfferInput, target: { name: string; requiredTemplates?: string[]; requiredRoles?: string[]; ludusSupported?: boolean }): string {
  if (!input.inventory) return ""
  return goadInstallBlock(target, input.inventory)
}

function say(input: GoadOfferInput, text: string): GoadOfferResult {
  input.onEvent({ type: "delta", text })
  return { text, stopped: false }
}

/**
 * Catalog check and extension checklist for a GOAD deploy request.
 * This does not call the model. Apply is still required before anything starts.
 */
export async function offerGoadDeploy(input: GoadOfferInput): Promise<GoadOfferResult> {
  if (!input.configured) {
    return say(input, "LUX deploys GOAD through the GOAD integration on this server, but GOAD is not configured here.")
  }
  if (input.catalogError) {
    return say(input, "GOAD is configured on this server, but the lab catalog could not be read. Try again once the host answers.")
  }
  const plan = resolveGoadDeployPlan(input.intent, input.catalog)
  if (!plan.ok && plan.reason === "missing-lab") {
    const listed = plan.available.length > 0 ? plan.available.join(", ") : "none"
    return say(
      input,
      `LUX deploys GOAD through the GOAD integration on this server. ${plan.labHint} is not an available lab. Available labs: ${listed}.`,
    )
  }
  if (!plan.ok && plan.reason === "missing-range") {
    return askWhereToPutLab(input, plan.labHint)
  }
  if (!plan.ok) {
    return say(
      input,
      `${input.intent.labHint} is an available GOAD lab on this server. Name the range to deploy it on, for example "using rangeb range".`,
    )
  }
  if (!input.rangeExists) {
    return say(
      input,
      `${plan.lab} is an available GOAD lab. Range ${plan.rangeId} is not available to this user, so there is nothing to deploy.`,
    )
  }
  if (input.alreadyLinked) {
    return say(
      input,
      `${plan.lab} is an available GOAD lab, and range ${plan.rangeId} already has a GOAD instance in LUX. Open that lab instead of starting a second one.`,
    )
  }
  const labDef = input.catalog.labs.find((item) => item.name === plan.lab)
  const labBlock = labDef ? installBlock(input, labDef) : ""
  if (labBlock) return say(input, `${plan.lab} cannot be deployed. ${labBlock}`)
  const routerBlock = input.inventory ? routerDeployBlock(input.inventory) : ""
  if (routerBlock) return say(input, routerBlock)

  const intro = [
    `${plan.lab} is a GOAD lab, so it deploys through GOAD on this server rather than as a plain Ludus range.`,
    `It is available and can be deployed on ${plan.rangeId}.`,
    plan.description ? plan.description : "",
    "Choose any extensions below. Leave them unchecked to deploy the lab alone. Nothing starts until you press Apply.",
  ].filter(Boolean).join(" ")
  input.onEvent({ type: "delta", text: intro })

  const extensionOptions = plan.extensions.map((ext) => {
    const full = input.catalog.extensions.find((item) => item.name === ext.name) ?? ext
    const block = installBlock(input, full)
    return {
      id: ext.name,
      label: block ? `${ext.name} — ${block}` : ext.name,
      detail: ext.description || undefined,
      disabled: Boolean(block),
    }
  })
  const allowed = new Set(extensionOptions.filter((option) => !option.disabled).map((option) => option.id))
  const choice: LuxaiChoice = {
    id: randomUUID(),
    prompt: `Choose extensions for ${plan.lab} on ${plan.rangeId}. Leave them unchecked to deploy the lab alone. An extension that this host cannot install stays listed and cannot be selected. Continue only saves these answers. Nothing starts until you press Apply.`,
    multiple: true,
    options: extensionOptions,
  }
  input.onChoice?.(choice)
  input.onEvent({ type: "choice", choice })
  const waited = await waitForChoice(input, choice.id, allowed)
  if (waited.stopped) {
    const text = `${intro}\n\n_Stopped._`
    input.onEvent({ type: "delta", text })
    return { text, stopped: true }
  }

  if (!isGoadCatalogName(plan.lab)) {
    return say(input, "That lab is not in the GOAD catalog.")
  }
  const extensions = catalogExtensions(waited.selected, allowed)
  const args = buildGoadWizardInstallArgs(plan.lab, extensions, { kind: "fresh" })
  const summary = extensions.length > 0
    ? `Deploy ${plan.lab} on ${plan.rangeId} with ${extensions.join(", ")}`
    : `Deploy ${plan.lab} on ${plan.rangeId} with no extensions`
  const preview = [
    `Lab: ${plan.lab}`,
    `Range: ${plan.rangeId}`,
    `Extensions: ${extensions.length > 0 ? extensions.join(", ") : "none"}`,
  ].join("\n")
  const change = input.propose({ lab: plan.lab, extensions, rangeId: plan.rangeId, args, summary, preview })
  input.onEvent({ type: "pending", change })
  const text = `${intro}\n\n${summary}. Nothing starts until you press Apply.`
  input.onEvent({ type: "delta", text })
  return { text, stopped: false }
}

async function askWhereToPutLab(input: GoadOfferInput, labName: string): Promise<GoadOfferResult> {
  const lab = input.catalog.labs.find((item) => item.name.toLowerCase() === labName.toLowerCase())
  const extensionRows = input.catalog.extensions.filter((ext) => {
    const list = ext.compatibility ?? ["*"]
    return list.length === 0 || list.includes("*") || list.some((name) => name.toLowerCase() === labName.toLowerCase())
  })
  const allowed = new Set(extensionRows.filter((ext) => !installBlock(input, ext)).map((ext) => ext.name))
  const ranges = input.ranges ?? []
  const intro = `${labName} is an available GOAD lab on this server${lab?.description ? ` (${lab.description})` : ""}. Choose an existing range or create one, and any extensions. Continue only saves these answers. Nothing starts until you press Apply.`
  input.onEvent({ type: "delta", text: intro })
  const choice: LuxaiChoice = {
    id: randomUUID(),
    prompt: `Choose a range for ${labName}, then any extensions, one step at a time. Continue on the last step only saves these answers. Nothing starts until you press Apply.`,
    multiple: true,
    options: [],
    fields: [
      {
        id: "rangeMode",
        label: "Range",
        kind: "select",
        options: [
          { id: "new", label: "Create a new range" },
          ...ranges.map((range) => ({ id: range.id, label: range.name ? `${range.name} (${range.id})` : range.id })),
        ],
      },
      { id: "rangeId", label: "Range id", kind: "text", placeholder: "goad-mini" },
      { id: "name", label: "Range name", kind: "text", placeholder: labName },
      {
        id: "extensions",
        label: "Extensions",
        kind: "check",
        options: extensionRows.map((ext) => {
          const block = installBlock(input, ext)
          return { id: ext.name, label: block ? `${ext.name} — ${block}` : ext.name, detail: ext.description || undefined, disabled: Boolean(block) }
        }),
      },
    ],
  }
  input.onChoice?.(choice)
  input.onEvent({ type: "choice", choice })
  const waited = await waitForChoice(input, choice.id, allowed)
  if (waited.stopped) {
    const text = `${intro}\n\n_Stopped._`
    input.onEvent({ type: "delta", text })
    return { text, stopped: true }
  }
  const mode = waited.values.rangeMode || "new"
  const create = mode === "new"
    ? { rangeId: (waited.values.rangeId || "").trim(), name: (waited.values.name || "").trim() }
    : null
  const rangeId = create ? create.rangeId : mode
  if (!rangeId || (create && !create.name)) {
    return say(input, "A new range needs a range id and a range name. Fill in both, then press Continue.")
  }
  if (create && !/^[A-Za-z0-9_-]{1,64}$/.test(create.rangeId)) {
    return say(input, "The range id can use letters, numbers, hyphens, and underscores.")
  }
  if (!isGoadCatalogName(labName)) {
    return say(input, "That lab is not in the GOAD catalog.")
  }
  if (lab) {
    const block = installBlock(input, lab)
    if (block) return say(input, `${labName} cannot be deployed. ${block}`)
  }
  const routerBlock = input.inventory ? routerDeployBlock(input.inventory) : ""
  if (routerBlock) return say(input, routerBlock)
  const extensions = catalogExtensions(waited.selected, allowed)
  const blocked = extensionRows.find((ext) => extensions.includes(ext.name) && installBlock(input, ext))
  if (blocked) return say(input, `${blocked.name} cannot be installed. ${installBlock(input, blocked)}`)
  const args = buildGoadWizardInstallArgs(labName, extensions, { kind: "fresh" })
  const copy = rangePlanCopy({ existing: !create, deploy: true, rangeId, lab: labName })
  const summary = copy.summary
  const preview = [
    create ? `Create range ${create.rangeId} (${create.name})` : `Range: ${rangeId}`,
    `Lab: ${labName}`,
    `Extensions: ${extensions.length > 0 ? extensions.join(", ") : "none"}`,
    copy.applyLine,
  ].join("\n")
  const change = input.propose({
    lab: labName,
    extensions,
    rangeId,
    args,
    summary,
    preview,
    create,
  })
  input.onEvent({ type: "pending", change })
  const text = `${intro}\n\n${summary}. Nothing starts until you press Apply.`
  input.onEvent({ type: "delta", text })
  return { text, stopped: false }
}

export async function askHowToBuildRange(input: GoadOfferInput): Promise<GoadOfferResult & { followUp?: string }> {
  const labs = input.catalog.labs
  const blueprints = input.blueprints ?? []
  const templates = input.templates ?? []
  const intro = "Choose a Ludus range or a GOAD lab. A choice this host cannot deploy stays in the list with the reason. Continue only saves these answers. Nothing is created until you press Apply."
  input.onEvent({ type: "delta", text: intro })
  const choice: LuxaiChoice = {
    id: randomUUID(),
    prompt: "Build this range one step at a time, the same way as Deploy New Range. Continue on the last step only saves these answers. Nothing is created until you press Apply.",
    multiple: true,
    options: [],
    fields: [
      {
        id: "kind",
        label: "Range type",
        kind: "select",
        options: [
          { id: "ludus", label: "Ludus range" },
          ...labs.map((lab) => {
            const block = lab.ludusSupported === false ? "No Ludus provider" : installBlock(input, lab)
            return {
              id: lab.name,
              label: block ? `GOAD ${lab.name} — ${block}` : `GOAD ${lab.name}`,
              detail: lab.description || undefined,
              disabled: Boolean(block),
            }
          }),
        ],
      },
      {
        id: "start",
        label: "How to start",
        kind: "select",
        showWhen: [{ field: "kind", equals: "ludus" }],
        options: [
          { id: "blueprint", label: "A blueprint, then change it" },
          { id: "scratch", label: "From scratch" },
        ],
      },
      {
        id: "blueprint",
        label: "Blueprint",
        kind: "select",
        showWhen: [{ field: "kind", equals: "ludus" }, { field: "start", equals: "blueprint" }],
        options: blueprints.length > 0
          ? blueprints.map((item) => ({
              id: item.id,
              label: item.block ? `${item.name} — ${item.block}` : item.name,
              detail: item.description,
              disabled: Boolean(item.block),
            }))
          : [{ id: "", label: "No blueprints are available to this account" }],
      },
      {
        id: "networks",
        label: "Networks",
        kind: "networks",
        showWhen: [{ field: "kind", equals: "ludus" }, { field: "start", equals: "scratch" }],
      },
      {
        id: "domain",
        label: "Domain name",
        kind: "text",
        placeholder: "meow.local",
        showWhen: [{ field: "kind", equals: "ludus" }, { field: "start", equals: "scratch" }],
      },
      {
        id: "vms",
        label: "Virtual machines",
        kind: "vms",
        showWhen: [{ field: "kind", equals: "ludus" }, { field: "start", equals: "scratch" }],
        options: templates.map((item) => ({
          id: item.id,
          label: item.built === false ? `${item.id} (not built)` : item.id,
          detail: item.os || undefined,
          disabled: item.built === false,
        })),
        roles: RANGE_VM_ROLES.map((item) => ({ id: item.id, label: item.label, detail: item.os })),
      },
      {
        id: "rules",
        label: "Firewall rules",
        kind: "rules",
        hideWhen: [{ field: "kind", equals: "ludus" }, { field: "start", equals: "blueprint" }],
      },
      {
        id: "rangeMode",
        label: "Range",
        kind: "select",
        options: [
          { id: "new", label: "Create a new range" },
          ...(input.ranges ?? []).map((range) => ({ id: range.id, label: range.name ? `${range.name} (${range.id})` : range.id })),
        ],
      },
      {
        id: "rangeId",
        label: "Range id",
        kind: "text",
        placeholder: "lab",
        showWhen: [{ field: "rangeMode", equals: "new" }],
      },
      {
        id: "name",
        label: "Range name",
        kind: "text",
        placeholder: "Lab",
        showWhen: [{ field: "rangeMode", equals: "new" }],
      },
      {
        id: "extensions",
        label: "GOAD extensions",
        kind: "check",
        showWhen: [{ field: "kind", notEquals: "ludus" }],
        options: input.catalog.extensions.map((ext) => {
          const block = installBlock(input, ext)
          return { id: ext.name, label: block ? `${ext.name} — ${block}` : ext.name, detail: ext.description || undefined, disabled: Boolean(block) }
        }),
      },
      {
        id: "action",
        label: "When you press Apply",
        kind: "select",
        options: [
          { id: "create", label: "Create the range only" },
          { id: "deploy", label: "Create the range and deploy it" },
        ],
      },
    ],
  }
  input.onChoice?.(choice)
  input.onEvent({ type: "choice", choice })
  const allowed = new Set(input.catalog.extensions.filter((ext) => !installBlock(input, ext)).map((ext) => ext.name))
  const waited = await waitForChoice(input, choice.id, allowed)
  if (waited.stopped) {
    const text = `${intro}\n\n_Stopped._`
    input.onEvent({ type: "delta", text })
    return { text, stopped: true }
  }
  const kind = waited.values.kind || "ludus"
  const mode = waited.values.rangeMode || "new"
  const deploy = waited.values.action === "deploy"
  const create = mode === "new"
    ? { rangeId: (waited.values.rangeId || "").trim(), name: (waited.values.name || "").trim() }
    : null
  const rangeId = create ? create.rangeId : mode
  if (kind === "ludus") {
    const fromBlueprint = (waited.values.start || "scratch") === "blueprint"
    const blueprint = waited.values.blueprint || ""
    if (!fromBlueprint) {
      const domain = (waited.values.domain || "").trim()
      const networks = parseRangeNetworks(waited.values.networks || "")
      const rules = parseRangeRules(waited.values.rules || "[]")
      const vms = parseRangeVms(waited.values.vms || "")
      const problem = [
        create ? validateRangeId(create.rangeId) : "",
        create ? validateRangeName(create.name) : "",
        validateNetworks(networks),
        validateDomain(domain, vms),
        validateRangeVms(vms, templates, networks),
        validateRules(rules, networks),
      ].find(Boolean)
      if (problem) return { text: problem, stopped: false }
      if (deploy && input.inventory) {
        const routerBlock = routerDeployBlock(input.inventory)
        if (routerBlock) return { text: routerBlock, stopped: false }
      }
      const warnings = domainJoinWarnings(vms, rules)
      const yaml = scratchRangeYaml(vms, rules, domain)
      const copy = rangePlanCopy({ existing: !create, deploy, rangeId })
      const summary = copy.summary
      const preview = [describeRangePlan(vms, networks, rules, domain), copy.applyLine, ...warnings].filter(Boolean).join("\n\n")
      const change = input.propose({
        lab: "",
        extensions: [],
        rangeId,
        args: "",
        summary,
        preview,
        create: create ?? { name: rangeId, rangeId },
        rules,
        yaml,
        deploy,
      })
      input.onEvent({ type: "pending", change })
      const text = [
        summary + ".",
        copy.applyLine,
        ...warnings,
        "You can edit the YAML on the proposal. Nothing changes until you press Apply.",
      ].join("\n\n")
      input.onEvent({ type: "delta", text })
      return { text, stopped: false }
    }
    const chosenBlueprint = blueprints.find((item) => item.id === blueprint)
    if (chosenBlueprint?.block) {
      return { text: `${chosenBlueprint.name} cannot be deployed. ${chosenBlueprint.block}`, stopped: false }
    }
    if (deploy && input.inventory) {
      const routerBlock = routerDeployBlock(input.inventory)
      if (routerBlock) return { text: routerBlock, stopped: false }
    }
    const followUp = [
      "The operator wants a Ludus range, not a GOAD lab.",
      create ? `Create range id ${create.rangeId || "(missing)"} named ${create.name || "(missing)"}.` : `Use existing range ${rangeId}.`,
      `Start from blueprint ${blueprint || "(none chosen)"}. Read that blueprint. If the range does not exist yet, call propose_create_range with that YAML in yaml. The operator edits it on the proposal before Apply.`,
      deploy
        ? (create
          ? "Call propose_create_range with that YAML and deploy true. Apply creates the range, uploads the config, and starts a full deploy. Do not call propose_deploy separately."
          : "Call propose_create_range with that YAML and deploy true. The range already exists. The summary and preview must say deploy, not create. Do not call propose_deploy separately.")
        : (create
          ? "Call propose_create_range with that YAML and deploy false. Do not deploy it."
          : "Call propose_create_range with that YAML and deploy false. The range already exists. The summary and preview must say update, not create. Do not deploy it."),
      "Do not propose an empty range. If the range id or name is missing, call ask_operator.",
    ].join(" ")
    return { text: intro, stopped: false, followUp }
  }
  if (!rangeId || (create && !create.name)) {
    return { text: "A new GOAD range needs an id and a name.", stopped: false }
  }
  const rawLab = labs.find((lab) => lab.name === kind)
  if (rawLab?.ludusSupported === false) return { text: `${rawLab.name} cannot be deployed. No Ludus provider`, stopped: false }
  const labName = catalogLabName(kind, labs.filter((lab) => lab.ludusSupported !== false))
  if (!labName) return { text: "That lab is not in the GOAD catalog.", stopped: false }
  const chosenLab = labs.find((lab) => lab.name === labName)
  if (chosenLab) {
    const block = installBlock(input, chosenLab)
    if (block) return { text: `${labName} cannot be deployed. ${block}`, stopped: false }
  }
  if (deploy && input.inventory) {
    const routerBlock = routerDeployBlock(input.inventory)
    if (routerBlock) return { text: routerBlock, stopped: false }
  }
  const extensions = catalogExtensions(waited.selected, allowed)
  const rules = parseRangeRules(waited.values.rules || "[]")
  const ruleProblem = validateRules(rules)
  if (ruleProblem) return { text: ruleProblem, stopped: false }
  const ruleText = rules.length > 0
    ? rules.map((rule) => `${rule.name}: ${rule.vlanSrc} to ${rule.vlanDst} ${rule.protocol}${rule.ports ? ` ${rule.ports}` : ""} ${rule.action}`).join("; ")
    : "none"
  const incompatible = extensions.filter((name) => {
    const ext = input.catalog.extensions.find((item) => item.name === name)
    const list = ext?.compatibility ?? ["*"]
    return list.length > 0 && !list.includes("*") && !list.some((item) => item.toLowerCase() === labName.toLowerCase())
  })
  if (incompatible.length > 0) {
    return { text: `${incompatible.join(", ")} cannot be installed into ${labName}.`, stopped: false }
  }
  const args = buildGoadWizardInstallArgs(labName, extensions, { kind: "fresh" })
  const copy = rangePlanCopy({ existing: !create, deploy, rangeId, lab: labName })
  const summary = copy.summary
  const preview = [
    create ? `Create range ${create.rangeId} (${create.name})` : `Range: ${rangeId}`,
    `Lab: ${labName}`,
    `Extensions: ${extensions.length > 0 ? extensions.join(", ") : "none"}`,
    `Firewall rules: ${ruleText}`,
    copy.applyLine,
  ].join("\n")
  if (!deploy) {
    const change = input.propose({
      lab: labName,
      extensions,
      rangeId,
      args: "",
      summary,
      preview,
      create: create ?? { name: rangeId, rangeId },
      rules,
    })
    input.onEvent({ type: "pending", change })
    const text = `${intro}\n\n${summary}. The lab install waits until you ask to deploy it.`
    input.onEvent({ type: "delta", text })
    return { text, stopped: false }
  }
  const change = input.propose({ lab: labName, extensions, rangeId, args, summary, preview, create, rules })
  input.onEvent({ type: "pending", change })
  const text = `${intro}\n\n${summary}. Nothing starts until you press Apply.`
  input.onEvent({ type: "delta", text })
  return { text, stopped: false }
}

async function waitForChoice(
  input: GoadOfferInput,
  choiceId: string,
  allowed: Set<string>,
): Promise<{ selected: string[]; values: Record<string, string>; stopped: boolean }> {
  for (;;) {
    if (input.signal?.aborted) return { selected: [], values: {}, stopped: true }
    const control = input.control?.()
    if (input.control && !control) return { selected: [], values: {}, stopped: true }
    if (control?.status === "stopped") return { selected: [], values: {}, stopped: true }
    const answer = input.takeAnswer?.()
    if (answer && answer.choiceId === choiceId) {
      const selected = answer.selected.filter((name) => allowed.has(name))
      return { selected: [...new Set(selected)], values: answer.values ?? {}, stopped: false }
    }
    if (control && control.status !== "paused" && control.steer) {
      input.onEvent({ type: "steer", text: control.steer })
      input.clearSteer?.()
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}
