import { randomUUID } from "node:crypto"
import yaml from "js-yaml"
import { LUXAI_LIMITS } from "@/lib/luxai/defaults"
import { findLabPassword, redactSecrets, userNamedAccount, clipText } from "@/lib/luxai/redact"
import { sanitizeNetworkRulesYaml } from "@/lib/range/network-rules"
import { inferOS } from "@/lib/range/range-vm-wizard"
import { fillAskFields } from "@/lib/luxai/ask-fields"
import { listSkillNames, readSkill } from "@/lib/luxai/skills"
import { insertChange } from "@/lib/luxai/store"
import type { LuxaiChangeView, LuxaiChoice, LuxaiChoiceField } from "@/lib/luxai/types"
import { extractArray } from "@/lib/core/utils"

const RANGE_ID = /^[A-Za-z0-9_-]{1,64}$/
const TOKEN = /^[A-Za-z0-9_.-]{1,64}$/
const HOST_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export interface DeploySpec {
  tags: string[]
  limit: string
  onlyRoles: string[]
  force: boolean
}

export interface LuxaiHost {
  listRanges(apiKey: string): Promise<unknown>
  readRange(apiKey: string, rangeId: string): Promise<unknown>
  readConfig(apiKey: string, rangeId: string): Promise<string>
  writeConfig(apiKey: string, rangeId: string, yamlText: string): Promise<void>
  power(apiKey: string, rangeId: string, mode: "on" | "off", machines: string[]): Promise<void>
  deploy(apiKey: string, rangeId: string, spec: DeploySpec): Promise<void>
  readInventory(apiKey: string, rangeId: string): Promise<string>
  runGuest(apiKey: string, rangeId: string, host: string, module: string, command: string): Promise<string>
  describeGoad(rangeId: string): Promise<string>
  listGoadCatalog(): Promise<string>
  createRange(apiKey: string, rangeId: string, name: string): Promise<void>
  deleteRange(apiKey: string, rangeId: string): Promise<void>
  fetchDoc(slug: string): Promise<string>
  /** Start a GOAD install that was already confirmed. Returns the task id. */
  startGoadDeploy(apiKey: string, rangeId: string, args: string, networkRulesJson?: string): Promise<string>
}

export interface ToolContext {
  username: string
  apiKey: string
  sessionId: string
  userText: string
  host: LuxaiHost
  /** Shows a form and waits. Null when the operator stops the run. */
  ask?: (choice: LuxaiChoice) => Promise<{ selected: string[]; values: Record<string, string> } | null>
}

export interface ToolOutcome {
  text: string
  ok: boolean
  change?: LuxaiChangeView
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

const objectSchema = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
})

const rangeIdProp = { type: "string", description: "Ludus range id" }

export const LUXAI_TOOLS: ToolSpec[] = [
  {
    name: "list_ranges",
    description: "List ranges this user can access.",
    parameters: objectSchema({}, []),
  },
  {
    name: "get_range",
    description: "Read one range: state, testing flag, and VM name, address, and power.",
    parameters: objectSchema({ rangeId: rangeIdProp }, ["rangeId"]),
  },
  {
    name: "get_range_config",
    description: "Read the current range-config YAML.",
    parameters: objectSchema({ rangeId: rangeIdProp }, ["rangeId"]),
  },
  {
    name: "get_inventory",
    description: "Read the Ansible inventory with passwords redacted.",
    parameters: objectSchema({ rangeId: rangeIdProp }, ["rangeId"]),
  },
  {
    name: "describe_goad",
    description: "Read the GOAD instance linked to a range, if LUX has one.",
    parameters: objectSchema({ rangeId: rangeIdProp }, ["rangeId"]),
  },
  {
    name: "list_goad_labs",
    description: "List GOAD labs and extensions installed on this LUX server. Use this before proposing a GOAD lab.",
    parameters: objectSchema({}, []),
  },
  {
    name: "propose_create_range",
    description: "Propose creating a Ludus range. Include yaml as the full range-config the operator will edit before Apply. Set deploy true when they asked to deploy as well. Apply creates the range, uploads that config, and starts a full deploy when deploy is true. Do not call propose_deploy separately for a range that does not exist yet.",
    parameters: objectSchema(
      {
        rangeId: rangeIdProp,
        name: { type: "string" },
        summary: { type: "string" },
        yaml: { type: "string" },
        deploy: { type: "boolean" },
      },
      ["rangeId", "name", "yaml"],
    ),
  },
  {
    name: "propose_delete_range",
    description: "Propose deleting a Ludus range. Does not delete it until the operator presses Apply. This cannot be reverted.",
    parameters: objectSchema(
      { rangeId: rangeIdProp, summary: { type: "string" } },
      ["rangeId"],
    ),
  },
  {
    name: "ask_operator",
    description: "Show a form when a requirement is missing. The prompt is one or two sentences: what to choose, and that Continue only saves the answers. Each label names the value, such as Range or Range id. For an existing range, send a field with id rangeId. LUX replaces it with a dropdown of the ranges this user can access. For an AD CS configuration, send a field with id configuration. LUX replaces it with the configurations it can set. Do not ask them to type either value.",
    parameters: objectSchema(
      {
        prompt: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              kind: { type: "string", enum: ["text", "select", "check"] },
              options: { type: "array", items: { type: "object" } },
            },
            required: ["id", "label", "kind"],
          },
        },
      },
      ["prompt", "fields"],
    ),
  },
  {
    name: "read_skill",
    description: `Read one bundled skill. Names: ${listSkillNames().join(", ")}.`,
    parameters: objectSchema({ name: { type: "string" } }, ["name"]),
  },
  {
    name: "fetch_ludus_doc",
    description: "Fetch one page from the official Ludus docs. Slug: configuration, mcp, or quick-start.",
    parameters: objectSchema({ slug: { type: "string" } }, ["slug"]),
  },
  {
    name: "reveal_lab_password",
    description: "Return one inventory password when the operator's message names that account.",
    parameters: objectSchema({ rangeId: rangeIdProp, account: { type: "string" } }, ["rangeId", "account"]),
  },
  {
    name: "propose_range_config",
    description: "Propose a new range-config YAML. Does not upload it. The previous YAML is kept for revert.",
    parameters: objectSchema(
      { rangeId: rangeIdProp, yaml: { type: "string" }, summary: { type: "string" } },
      ["rangeId", "yaml", "summary"],
    ),
  },
  {
    name: "propose_power",
    description: "Propose powering VMs on or off. Does not change power.",
    parameters: objectSchema(
      {
        rangeId: rangeIdProp,
        mode: { type: "string", enum: ["on", "off"] },
        machines: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      ["rangeId", "mode", "summary"],
    ),
  },
  {
    name: "propose_deploy",
    description: "Propose a range deploy. Does not start it. Empty tags means a full deploy.",
    parameters: objectSchema(
      {
        rangeId: rangeIdProp,
        tags: { type: "array", items: { type: "string" } },
        limit: { type: "string" },
        onlyRoles: { type: "array", items: { type: "string" } },
        force: { type: "boolean" },
        summary: { type: "string" },
      },
      ["rangeId", "summary"],
    ),
  },
  {
    name: "propose_guest_command",
    description: "Propose one shell or PowerShell command on one inventory host. A short name such as DC01 matches the VM whose name ends with it, for example range-GOAD-DC01. Does not run it. A guest command cannot be reverted automatically.",
    parameters: objectSchema(
      {
        rangeId: rangeIdProp,
        host: { type: "string", description: "Inventory hostname, not an address" },
        shell: { type: "string", enum: ["posix", "powershell"] },
        command: { type: "string" },
        summary: { type: "string" },
      },
      ["rangeId", "host", "shell", "command", "summary"],
    ),
  },
]

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function argText(args: Record<string, unknown>, key: string): string {
  const want = key.toLowerCase()
  for (const [name, value] of Object.entries(args)) {
    if (name.toLowerCase() === want && typeof value === "string") return value.trim()
  }
  return ""
}

function rangeId(args: Record<string, unknown>): string {
  const id = argText(args, "rangeId") || argText(args, "rangeID") || argText(args, "range_id") || argText(args, "id") || argText(args, "range")
  if (!RANGE_ID.test(id)) throw new Error("Range id is not valid.")
  return id
}

function rangeHint(args: Record<string, unknown>): string {
  return argText(args, "rangeName") || argText(args, "lab") || argText(args, "query")
}

function rangeNumber(args: Record<string, unknown>): number | null {
  const raw = args.rangeNumber ?? args.number
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN
  return Number.isInteger(value) ? value : null
}

interface ListedRange {
  id: string
  name: string
  number: number | null
}

async function listedRanges(ctx: ToolContext): Promise<ListedRange[]> {
  const data = await ctx.host.listRanges(ctx.apiKey)
  return extractArray<Record<string, unknown>>(data).flatMap((row) => {
    const id = str(row.rangeID) || str(row.rangeId)
    if (!RANGE_ID.test(id)) return []
    const number = typeof row.rangeNumber === "number" ? row.rangeNumber : Number(row.rangeNumber)
    return [{ id, name: str(row.name), number: Number.isInteger(number) ? number : null }]
  })
}

/** A direct id, a range number, or a lab hint such as GOAD-Mini. */
async function resolveRangeId(args: Record<string, unknown>, ctx: ToolContext, literal = false): Promise<string> {
  try {
    return rangeId(args)
  } catch (err) {
    if (literal) throw err
  }
  const ranges = await listedRanges(ctx)
  const number = rangeNumber(args)
  if (number != null) {
    const hits = ranges.filter((range) => range.number === number)
    if (hits.length === 1) return hits[0].id
    if (hits.length > 1) throw new Error(`Range number ${number} matches more than one range.`)
  }
  const hint = rangeHint(args)
  if (hint) {
    const want = hint.toLowerCase()
    const hits = ranges.filter((range) =>
      range.id.toLowerCase() === want
      || range.name.toLowerCase() === want
      || range.id.toLowerCase().includes(want)
      || range.name.toLowerCase().includes(want),
    )
    if (hits.length === 1) return hits[0].id
    if (hits.length > 1) throw new Error(`"${hint}" matches more than one range: ${hits.map((range) => range.id).join(", ")}.`)
  }
  throw new Error("Range id is not valid.")
}

function vmNames(data: unknown): string[] {
  const record = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
  const nested = record.result && typeof record.result === "object" ? record.result as Record<string, unknown> : record
  const vms = Array.isArray(nested.VMs) ? nested.VMs : []
  return vms.flatMap((vm) => {
    const name = str((vm as { name?: unknown }).name)
    return name ? [name] : []
  })
}

/** DC01 matches a VM named range-GOAD-DC01. An exact name wins. */
export function resolveHostName(names: readonly string[], hint: string): string {
  const want = hint.trim().toLowerCase()
  if (!want) throw new Error("Host name is empty.")
  const exact = names.filter((name) => name.toLowerCase() === want)
  if (exact.length === 1) return exact[0]
  const suffix = names.filter((name) => name.toLowerCase().endsWith(`-${want}`) || name.toLowerCase().endsWith(`_${want}`))
  if (suffix.length === 1) return suffix[0]
  if (suffix.length > 1) throw new Error(`"${hint}" matches more than one host: ${suffix.join(", ")}.`)
  throw new Error(`No host named ${hint}. Hosts: ${names.join(", ") || "none"}.`)
}

function tokens(value: unknown, label: string): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`)
  if (value.length > 16) throw new Error(`${label} has too many entries.`)
  return value.map((item) => {
    const token = str(item)
    if (!TOKEN.test(token)) throw new Error(`${label} has an invalid entry.`)
    return token
  })
}

function summarizeRange(data: unknown): unknown {
  const rows = extractArray<Record<string, unknown>>(data)
  return rows.map((row) => ({
    rangeID: row.rangeID ?? row.rangeId ?? null,
    rangeNumber: row.rangeNumber ?? null,
    accessType: row.accessType ?? null,
  }))
}

function summarizeVms(data: unknown): unknown {
  const record = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
  const nested = record.result && typeof record.result === "object" ? record.result as Record<string, unknown> : record
  const vms = Array.isArray(nested.VMs) ? nested.VMs : []
  return {
    rangeID: nested.rangeID ?? null,
    name: nested.name ?? null,
    rangeNumber: nested.rangeNumber ?? null,
    rangeState: nested.rangeState ?? null,
    testingEnabled: nested.testingEnabled ?? null,
    VMs: vms.slice(0, 80).map((vm) => {
      const row = vm as Record<string, unknown>
      const name = str(row.name)
      const parts = name.split("-").filter(Boolean)
      const aliases = parts.length > 1 ? [parts[parts.length - 1], parts.slice(-2).join("-")] : []
      return {
        name: name || null,
        aliases: [...new Set(aliases.filter((alias) => alias.toLowerCase() !== name.toLowerCase()))],
        ip: row.ip ?? null,
        poweredOn: row.poweredOn ?? null,
      }
    }),
  }
}

export function prepareUploadedYaml(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new Error("Range config is empty.")
  assertYaml(trimmed)
  return sanitizeNetworkRulesYaml(ensureVmOsYaml(trimmed))
}

/** Ludus accepts a VM only when it has exactly one of windows, linux, or macOS. */
function ensureVmOsYaml(text: string): string {
  const doc = yaml.load(text)
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return text
  const ludus = (doc as { ludus?: unknown }).ludus
  if (!Array.isArray(ludus)) return text
  let changed = false
  for (const [index, item] of ludus.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const vm = item as Record<string, unknown>
    const present = osKeys(vm)
    if (present.length > 1) {
      const name = String(vm.hostname || vm.vm_name || `ludus.${index}`)
      throw new Error(`${name} sets more than one of windows, linux, and macOS. Ludus accepts only one.`)
    }
    if (present.length === 1) continue
    const template = String(vm.template ?? vm.vm_name ?? "")
    const os = osForTemplate(template)
    if (os === "windows") vm.windows = { sysprep: false }
    else if (os === "macos") vm.macOS = true
    else vm.linux = true
    changed = true
  }
  if (!changed) return text
  return yaml.dump(doc, { indent: 2, lineWidth: -1, noRefs: true })
}

function osKeys(vm: Record<string, unknown>): string[] {
  const keys: string[] = []
  if (vm.windows && typeof vm.windows === "object") keys.push("windows")
  if (vm.linux === true || (vm.linux && typeof vm.linux === "object")) keys.push("linux")
  if (vm.macOS === true || vm.macos === true) keys.push("macOS")
  return keys
}

function osForTemplate(template: string): "windows" | "linux" | "macos" {
  if (/macos|osx|darwin/i.test(template)) return "macos"
  return inferOS(template).isWindows ? "windows" : "linux"
}

function assertYaml(text: string): void {
  if (text.length > LUXAI_LIMITS.configMax) throw new Error("Range config is too large.")
  const doc = yaml.load(text)
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Range config must be a YAML mapping.")
  }
  const ludus = (doc as { ludus?: unknown }).ludus
  if (!Array.isArray(ludus) || ludus.length === 0) {
    throw new Error("Range config needs a ludus list with at least one VM.")
  }
}

function restoreRedactedLines(proposed: string, current: string): string {
  if (!proposed.includes("[redacted]")) return proposed
  const currentByKey = new Map<string, string>()
  for (const line of current.split("\n")) {
    const key = line.split(/[:=]/)[0]?.trim()
    if (key && /password|secret|api[_-]?key/i.test(line)) currentByKey.set(key, line)
  }
  return proposed.split("\n").map((line) => {
    if (!line.includes("[redacted]")) return line
    const key = line.split(/[:=]/)[0]?.trim()
    const original = key ? currentByKey.get(key) : undefined
    if (!original) {
      throw new Error("A redacted secret could not be copied from the current config. Omit that line instead of sending [redacted].")
    }
    return original
  }).join("\n")
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  try {
    const text = await runTool(name, args, ctx)
    return text
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool failed."
    return { ok: false, text: message.slice(0, 500) }
  }
}

async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case "list_ranges": {
      const data = await ctx.host.listRanges(ctx.apiKey)
      return { ok: true, text: clipText(JSON.stringify(summarizeRange(data)), LUXAI_LIMITS.toolResultMax) }
    }
    case "get_range": {
      const id = await resolveRangeId(args, ctx)
      const data = await ctx.host.readRange(ctx.apiKey, id)
      return { ok: true, text: clipText(JSON.stringify(summarizeVms(data)), LUXAI_LIMITS.toolResultMax) }
    }
    case "get_range_config": {
      const id = await resolveRangeId(args, ctx)
      const config = redactSecrets(await ctx.host.readConfig(ctx.apiKey, id))
      return { ok: true, text: clipText(config, LUXAI_LIMITS.toolResultMax) }
    }
    case "get_inventory": {
      const id = await resolveRangeId(args, ctx)
      const inventory = redactSecrets(await ctx.host.readInventory(ctx.apiKey, id))
      return { ok: true, text: clipText(inventory, LUXAI_LIMITS.toolResultMax) }
    }
    case "describe_goad": {
      const id = await resolveRangeId(args, ctx)
      await ctx.host.readRange(ctx.apiKey, id)
      const text = await ctx.host.describeGoad(id)
      return { ok: true, text: clipText(text, LUXAI_LIMITS.toolResultMax) }
    }
    case "list_goad_labs": {
      const text = await ctx.host.listGoadCatalog()
      return { ok: true, text: clipText(text, LUXAI_LIMITS.toolResultMax) }
    }
    case "ask_operator": {
      if (!ctx.ask) return { ok: false, text: "The question form is not available on this turn." }
      const choice = parseAsk(args)
      let ranges: Array<{ id: string; name: string }> = []
      try {
        ranges = await listedRanges(ctx)
      } catch {
        ranges = []
      }
      const filled = fillAskFields(choice, { ranges, userText: ctx.userText })
      for (const field of filled.fields ?? []) {
        if ((field.kind === "select" || field.kind === "check") && (field.options ?? []).length === 0) {
          throw new Error(`Field ${field.id} needs options.`)
        }
      }
      const answer = await ctx.ask(filled)
      if (!answer) return { ok: false, text: "The operator stopped before answering." }
      return { ok: true, text: JSON.stringify(answer) }
    }
    case "propose_create_range": {
      const id = await resolveRangeId(args, ctx, true)
      const name = str(args.name)
      if (!name) throw new Error("Range name is empty.")
      const uploaded = prepareUploadedYaml(typeof args.yaml === "string" ? args.yaml : "")
      const deploy = args.deploy === true
      const change = insertChange({
        sessionId: ctx.sessionId,
        username: ctx.username,
        rangeId: id,
        kind: "range_create",
        summary: str(args.summary).slice(0, 400) || `Create range ${id}`,
        preview: deploy
          ? "Edit the range config, then Apply. That creates the range, uploads this config, and starts a full deploy."
          : "Edit the range config, then Apply. That creates the range and uploads this config.",
        beforeText: "",
        afterText: JSON.stringify({ name, rangeId: id, yaml: uploaded, deploy }),
        revertable: false,
      })
      return {
        ok: true,
        change,
        text: deploy
          ? `Proposal ${change.id} creates range ${id}, uploads the config, and starts a full deploy when the operator presses Apply. They can edit the YAML on the proposal first. Nothing was created.`
          : `Proposal ${change.id} creates range ${id} and uploads the config when the operator presses Apply. They can edit the YAML on the proposal first. Nothing was created.`,
      }
    }
    case "propose_delete_range": {
      const id = await resolveRangeId(args, ctx)
      await ctx.host.readRange(ctx.apiKey, id)
      const change = insertChange({
        sessionId: ctx.sessionId,
        username: ctx.username,
        rangeId: id,
        kind: "range_delete",
        summary: str(args.summary).slice(0, 400) || `Delete range ${id}`,
        preview: `Delete range ${id}. This cannot be undone.`,
        beforeText: "",
        afterText: JSON.stringify({ rangeId: id }),
        revertable: false,
      })
      return { ok: true, change, text: `Proposal ${change.id} deletes range ${id} when the operator presses Apply. Nothing was deleted.` }
    }
    case "read_skill": {
      const skill = readSkill(str(args.name))
      if (!skill) return { ok: false, text: `Unknown skill. Choose one of: ${listSkillNames().join(", ")}.` }
      return { ok: true, text: skill }
    }
    case "fetch_ludus_doc": {
      const slug = str(args.slug)
      const text = await ctx.host.fetchDoc(slug)
      return { ok: true, text: clipText(text, LUXAI_LIMITS.toolResultMax) }
    }
    case "reveal_lab_password": {
      const id = await resolveRangeId(args, ctx)
      const account = str(args.account)
      if (!userNamedAccount(ctx.userText, account)) {
        return { ok: false, text: "The operator's message does not name that account." }
      }
      const inventory = await ctx.host.readInventory(ctx.apiKey, id)
      const hit = findLabPassword(inventory, account)
      if (!hit) return { ok: false, text: "That account was not found in the inventory." }
      return { ok: true, text: `${hit.host} ansible_user=${hit.account} ansible_password=${hit.password}` }
    }
    case "propose_range_config": {
      const id = await resolveRangeId(args, ctx)
      const next = typeof args.yaml === "string" ? args.yaml : ""
      let current = ""
      try {
        current = await ctx.host.readConfig(ctx.apiKey, id)
      } catch {
        return {
          ok: false,
          text: "That range does not exist yet. Call propose_create_range with this same yaml so the operator can edit it before the range is created.",
        }
      }
      const restored = restoreRedactedLines(next, current)
      const uploaded = prepareUploadedYaml(restored)
      const change = insertChange({
        sessionId: ctx.sessionId,
        username: ctx.username,
        rangeId: id,
        kind: "range_config",
        summary: str(args.summary).slice(0, 400) || "Update range config",
        preview: "Edit the range config, then Apply.",
        beforeText: current,
        afterText: uploaded,
        revertable: true,
      })
      return {
        ok: true,
        change,
        text: `Proposal ${change.id} is waiting for the operator to apply it. The previous config is stored for revert. Nothing was uploaded.`,
      }
    }
    case "propose_power": {
      const id = await resolveRangeId(args, ctx)
      await ctx.host.readRange(ctx.apiKey, id)
      const mode = args.mode === "off" ? "off" : args.mode === "on" ? "on" : ""
      if (!mode) throw new Error("Power mode must be on or off.")
      const machines = tokens(args.machines, "machines")
      const change = insertChange({
        sessionId: ctx.sessionId,
        username: ctx.username,
        rangeId: id,
        kind: "power",
        summary: str(args.summary).slice(0, 400) || `Power ${mode}`,
        preview: `${mode} ${machines.join(", ") || "(whole range)"}`,
        beforeText: "",
        afterText: JSON.stringify({ mode, machines }),
        revertable: false,
      })
      return { ok: true, change, text: `Proposal ${change.id} is waiting for the operator. Power was not changed.` }
    }
    case "propose_deploy": {
      const id = await resolveRangeId(args, ctx)
      await ctx.host.readRange(ctx.apiKey, id)
      const spec: DeploySpec = {
        tags: tokens(args.tags, "tags"),
        limit: str(args.limit),
        onlyRoles: tokens(args.onlyRoles, "onlyRoles"),
        force: args.force === true,
      }
      if (spec.limit && !spec.limit.split(",").every((part) => TOKEN.test(part.trim()))) {
        throw new Error("Deploy limit has an invalid host.")
      }
      const change = insertChange({
        sessionId: ctx.sessionId,
        username: ctx.username,
        rangeId: id,
        kind: "deploy",
        summary: str(args.summary).slice(0, 400) || "Deploy range",
        preview: JSON.stringify(spec),
        beforeText: "",
        afterText: JSON.stringify(spec),
        revertable: false,
      })
      return {
        ok: true,
        change,
        text: `Proposal ${change.id} is waiting for the operator. The deploy has not started. Revert will not undo a deploy.`,
      }
    }
    case "propose_guest_command": {
      const id = await resolveRangeId(args, ctx)
      const range = await ctx.host.readRange(ctx.apiKey, id)
      const hint = str(args.host) || argText(args, "hostname") || argText(args, "vm") || argText(args, "machine")
      const host = resolveHostName(vmNames(range), hint)
      if (!HOST_NAME.test(host)) throw new Error("Host name is not valid.")
      const shell = args.shell === "powershell" ? "powershell" : args.shell === "posix" ? "posix" : ""
      if (!shell) throw new Error("Shell must be posix or powershell.")
      const command = typeof args.command === "string" ? args.command : ""
      if (!command.trim()) throw new Error("Command is empty.")
      if (command.length > LUXAI_LIMITS.commandMax) throw new Error("Command is too long.")
      if (command.includes("\u0000")) throw new Error("Command is not valid.")
      const guestModule = shell === "powershell" ? "ansible.windows.win_shell" : "ansible.builtin.shell"
      const change = insertChange({
        sessionId: ctx.sessionId,
        username: ctx.username,
        rangeId: id,
        kind: "guest_command",
        summary: str(args.summary).slice(0, 400) || `Command on ${host}`,
        preview: `${host} (${guestModule})\n${command}`,
        beforeText: "",
        afterText: JSON.stringify({ host, module: guestModule, command }),
        revertable: false,
      })
      return {
        ok: true,
        change,
        text: `Proposal ${change.id} targets ${host}${host.toLowerCase() === hint.toLowerCase() ? "" : ` (matched from ${hint})`}. The command was not run. A guest command cannot be reverted automatically.`,
      }
    }
    default:
      return { ok: false, text: "That tool is not available." }
  }
}

export function parseAsk(args: Record<string, unknown>): LuxaiChoice {
  const prompt = str(args.prompt)
  if (!prompt) throw new Error("The question is empty.")
  if (!Array.isArray(args.fields) || args.fields.length === 0) throw new Error("The question needs at least one field.")
  const fields: LuxaiChoiceField[] = []
  for (const item of args.fields.slice(0, 8)) {
    const field = item as { id?: unknown; label?: unknown; kind?: unknown; options?: unknown }
    const id = str(field.id)
    const label = str(field.label)
    const kind = field.kind === "text" || field.kind === "select" || field.kind === "check" ? field.kind : ""
    if (!id || !label || !kind) throw new Error("A question field needs an id, a label, and a kind.")
    const options = Array.isArray(field.options)
      ? field.options.slice(0, 32).flatMap((option) => {
          const row = option as { id?: unknown; label?: unknown; detail?: unknown }
          const optionId = str(row.id)
          const optionLabel = str(row.label) || optionId
          if (!optionId) return []
          return [{ id: optionId, label: optionLabel, detail: str(row.detail) || undefined }]
        })
      : []
    fields.push({ id, label, kind, options })
  }
  return { id: randomUUID(), prompt, multiple: true, options: [], fields }
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object")
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error("Tool arguments were not a JSON object.")
  }
}
