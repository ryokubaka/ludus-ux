/**
 * Ludus range router Packer template — required for every range deploy (GOAD + Ludus).
 *
 * Resolution order when `router.template` is omitted from range YAML:
 * 1. Explicit `router.template` pin (or caller override)
 * 2. Ludus version (≥2.3.2 → Debian 13; older → Debian 11)
 * 3. Registered template catalog (Debian 13 registered → 2.3.2+; else Debian 11)
 * 4. Fallback: Debian 13 (current Ludus default)
 *
 * Sync helpers only — safe for client components. Live API check:
 * `@/lib/ludus-router-template-assert` (server).
 */

import yaml from "js-yaml"
import {
  ludusDefaultRouterUsesDebian13,
  parseLudusSemver,
} from "@/lib/ludus-version"

/** Ludus ≥2.3.2 default router Packer template. */
export const LUDUS_DEFAULT_ROUTER_TEMPLATE = "debian-13-x64-server-template"

/** Ludus <2.3.2 default router Packer template. */
export const LUDUS_LEGACY_ROUTER_TEMPLATE = "debian-11-x64-server-template"

export type RouterTemplateResolutionSource = "pinned" | "version" | "catalog_inferred" | "fallback"

export interface RouterTemplateResolution {
  template: string
  vmNameSuffix: string
  source: RouterTemplateResolutionSource
}

export type RouterTemplateCheck =
  | { ok: true; template: string; resolution: RouterTemplateResolution }
  | {
      ok: false
      template: string
      reason: "missing" | "need_build" | "list_failed"
      error: string
      resolution?: RouterTemplateResolution
    }

export interface ResolveRouterTemplateOptions {
  ludusVersion?: string | null
  pinnedTemplate?: string | null
  configYaml?: string | null
  registeredTemplates?: Set<string> | string[] | Map<string, boolean>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function scalarString(value: unknown): string {
  if (value == null) return ""
  return (typeof value === "string" ? value : String(value)).trim()
}

function toRegisteredSet(
  registered: Set<string> | string[] | Map<string, boolean> | undefined,
): Set<string> {
  if (!registered) return new Set()
  if (registered instanceof Set) return registered
  if (registered instanceof Map) return new Set(registered.keys())
  return new Set(registered)
}

/** Suffix for Proxmox vm_name (`debian13-x64`, `debian11-x64`, …). */
export function templateToRouterVmNameSuffix(template: string): string {
  const m = template.match(/debian-(\d+)-x64-server-template/i)
  if (m) return `debian${m[1]}-x64`
  if (/debian-13/i.test(template)) return "debian13-x64"
  if (/debian-11/i.test(template)) return "debian11-x64"
  return "debian13-x64"
}

/** Proxmox vm_name for a router template and range ID. */
export function ludusRouterVmNameForTemplate(rangeId: string, template: string): string {
  return `${rangeId.trim()}-router-${templateToRouterVmNameSuffix(template)}`
}

/** Infer router template from an explicit `router.vm_name` (e.g. `…-router-debian11-x64`). */
export function inferRouterTemplateFromVmName(vmName: string): string | null {
  const m = vmName.match(/router-debian(\d+)-x64/i)
  if (!m) return null
  return `debian-${m[1]}-x64-server-template`
}

/** Parse `router.template` from range-config YAML when pinned. */
export function parseRouterTemplatePinFromYaml(yamlText: string): string | null {
  if (!yamlText.trim()) return null
  let doc: unknown
  try {
    doc = yaml.load(yamlText)
  } catch {
    return null
  }
  const router = asRecord(asRecord(doc)?.router)
  if (!router) return null
  const template = scalarString(router.template)
  return template || null
}

/** Normalize Ludus GET /version payload to a version string. */
export function extractLudusVersionString(versionPayload: unknown): string {
  if (versionPayload == null) return ""
  if (typeof versionPayload === "string") return versionPayload.trim()
  if (typeof versionPayload !== "object") return String(versionPayload).trim()
  const d = versionPayload as { result?: unknown; version?: unknown }
  if (typeof d.result === "string" && d.result.trim()) return d.result.trim()
  if (typeof d.version === "string" && d.version.trim()) return d.version.trim()
  return ""
}

/** Which router Packer template Ludus will use for an unpinned range deploy. */
export function resolveRequiredRouterTemplate(opts: {
  ludusVersion?: string | null
  pinnedTemplate?: string | null
  registeredTemplates?: Set<string> | string[] | Map<string, boolean>
}): RouterTemplateResolution {
  const pinned = opts.pinnedTemplate?.trim()
  if (pinned) {
    return {
      template: pinned,
      vmNameSuffix: templateToRouterVmNameSuffix(pinned),
      source: "pinned",
    }
  }

  const version = (opts.ludusVersion ?? "").trim()
  const registered = toRegisteredSet(opts.registeredTemplates)

  if (version && parseLudusSemver(version)) {
    const template = ludusDefaultRouterUsesDebian13(version)
      ? LUDUS_DEFAULT_ROUTER_TEMPLATE
      : LUDUS_LEGACY_ROUTER_TEMPLATE
    return {
      template,
      vmNameSuffix: templateToRouterVmNameSuffix(template),
      source: "version",
    }
  }

  if (registered.has(LUDUS_DEFAULT_ROUTER_TEMPLATE)) {
    return {
      template: LUDUS_DEFAULT_ROUTER_TEMPLATE,
      vmNameSuffix: templateToRouterVmNameSuffix(LUDUS_DEFAULT_ROUTER_TEMPLATE),
      source: "catalog_inferred",
    }
  }
  if (registered.has(LUDUS_LEGACY_ROUTER_TEMPLATE)) {
    return {
      template: LUDUS_LEGACY_ROUTER_TEMPLATE,
      vmNameSuffix: templateToRouterVmNameSuffix(LUDUS_LEGACY_ROUTER_TEMPLATE),
      source: "catalog_inferred",
    }
  }

  return {
    template: LUDUS_DEFAULT_ROUTER_TEMPLATE,
    vmNameSuffix: templateToRouterVmNameSuffix(LUDUS_DEFAULT_ROUTER_TEMPLATE),
    source: "fallback",
  }
}

/** Resolve router template using YAML pin + Ludus version + catalog. */
export function resolveRequiredRouterTemplateFromConfig(
  opts: ResolveRouterTemplateOptions,
): RouterTemplateResolution {
  const pinnedFromYaml = opts.configYaml ? parseRouterTemplatePinFromYaml(opts.configYaml) : null
  return resolveRequiredRouterTemplate({
    ludusVersion: opts.ludusVersion,
    pinnedTemplate: opts.pinnedTemplate ?? pinnedFromYaml,
    registeredTemplates: opts.registeredTemplates,
  })
}

/** Prepend the resolved router template so audits / UI chips always include it. */
export function withRouterTemplateRequired(
  required: string[],
  opts?: ResolveRouterTemplateOptions | string,
): string[] {
  const resolution =
    typeof opts === "string"
      ? resolveRequiredRouterTemplate({ pinnedTemplate: opts })
      : resolveRequiredRouterTemplateFromConfig(opts ?? {})

  const out: string[] = []
  const seen = new Set<string>()
  for (const name of [resolution.template, ...required]) {
    const n = name.trim()
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/** Whether the resolved router template is Packer-built. */
export function isRequiredRouterTemplateBuilt(
  builtMap: Map<string, boolean> | Set<string>,
  opts: ResolveRouterTemplateOptions,
): boolean {
  const template = resolveRequiredRouterTemplateFromConfig(opts).template
  if (builtMap instanceof Set) return builtMap.has(template)
  return builtMap.get(template) === true
}

/** Client-side: built + registered sets → ready for deploy. */
export function isRouterTemplateReadyForDeploy(opts: {
  builtNames: Set<string> | string[]
  allNames?: Set<string> | string[]
  ludusVersion?: string
  configYaml?: string
  pinnedTemplate?: string
}): boolean {
  const built = opts.builtNames instanceof Set ? opts.builtNames : new Set(opts.builtNames)
  const all =
    opts.allNames instanceof Set ? opts.allNames : new Set(opts.allNames ?? opts.builtNames)
  const builtMap = new Map<string, boolean>()
  for (const name of all) builtMap.set(name, built.has(name))
  for (const name of built) builtMap.set(name, true)
  return checkRouterTemplateBuilt(builtMap, {
    ludusVersion: opts.ludusVersion,
    configYaml: opts.configYaml,
    pinnedTemplate: opts.pinnedTemplate,
    registeredTemplates: all,
  }).ok
}

/** Resolved router template name for UI toasts when gate fails. */
export function requiredRouterTemplateName(opts?: ResolveRouterTemplateOptions): string {
  return resolveRequiredRouterTemplateFromConfig(opts ?? {}).template
}

export function checkRouterTemplateBuilt(
  builtMap: Map<string, boolean>,
  opts?: ResolveRouterTemplateOptions | string,
): RouterTemplateCheck {
  const resolution =
    typeof opts === "string"
      ? resolveRequiredRouterTemplate({ pinnedTemplate: opts })
      : resolveRequiredRouterTemplateFromConfig(opts ?? {})
  const template = resolution.template

  if (!builtMap.has(template)) {
    return {
      ok: false,
      template,
      reason: "missing",
      error: `Refused: Ludus router template not registered: ${template}`,
      resolution,
    }
  }
  if (!builtMap.get(template)) {
    return {
      ok: false,
      template,
      reason: "need_build",
      error: `Refused: Ludus router template not built: ${template}`,
      resolution,
    }
  }
  return { ok: true, template, resolution }
}

/** Default Ludus router Proxmox vm_name when `router:` is omitted from range config. */
export function ludusDefaultRouterVmName(
  rangeId: string,
  opts?: Pick<ResolveRouterTemplateOptions, "ludusVersion" | "configYaml" | "registeredTemplates">,
): string {
  const resolution = resolveRequiredRouterTemplateFromConfig({
    ludusVersion: opts?.ludusVersion,
    configYaml: opts?.configYaml,
    registeredTemplates: opts?.registeredTemplates,
  })
  return ludusRouterVmNameForTemplate(rangeId, resolution.template)
}

/** User-facing one-liner for toasts / SSE. */
export function routerTemplateBlockMessage(
  check: Extract<RouterTemplateCheck, { ok: false }>,
): string {
  if (check.reason === "missing") {
    return `${check.template} is not registered. Add and Packer-build it on Templates before any range deploy (Ludus router).`
  }
  if (check.reason === "need_build") {
    return `${check.template} is not built yet. Packer-build it on /templates before any range deploy (Ludus router).`
  }
  return check.error
}
