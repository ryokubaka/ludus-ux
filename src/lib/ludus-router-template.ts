/**
 * Ludus range router Packer template — required for every range deploy (GOAD + Ludus).
 * Default from Ludus range-config schema: router.template = debian-11-x64-server-template.
 *
 * Sync helpers only — safe for client components. Live API check:
 * `@/lib/ludus-router-template-assert` (server).
 */

/** Default Ludus router VM Packer template (docs.ludus.cloud range-config). */
export const LUDUS_DEFAULT_ROUTER_TEMPLATE = "debian-11-x64-server-template"

export type RouterTemplateCheck =
  | { ok: true; template: string }
  | {
      ok: false
      template: string
      reason: "missing" | "need_build" | "list_failed"
      error: string
    }

/** Prepend router template so audits / UI chips always include it. */
export function withRouterTemplateRequired(
  required: string[],
  template: string = LUDUS_DEFAULT_ROUTER_TEMPLATE,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const name of [template, ...required]) {
    const n = name.trim()
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

export function checkRouterTemplateBuilt(
  builtMap: Map<string, boolean>,
  template: string = LUDUS_DEFAULT_ROUTER_TEMPLATE,
): RouterTemplateCheck {
  if (!builtMap.has(template)) {
    return {
      ok: false,
      template,
      reason: "missing",
      error: `Refused: Ludus router template not registered: ${template}`,
    }
  }
  if (!builtMap.get(template)) {
    return {
      ok: false,
      template,
      reason: "need_build",
      error: `Refused: Ludus router template not built: ${template}`,
    }
  }
  return { ok: true, template }
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
