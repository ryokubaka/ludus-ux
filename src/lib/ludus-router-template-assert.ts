/**
 * Server-only: live Ludus GET /templates check for router Packer template.
 */

import { ludusRequest } from "@/lib/ludus-client"
import {
  LUDUS_DEFAULT_ROUTER_TEMPLATE,
  checkRouterTemplateBuilt,
  type RouterTemplateCheck,
} from "@/lib/ludus-router-template"

function parseBuiltMap(data: unknown): Map<string, boolean> {
  const map = new Map<string, boolean>()
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { templates?: unknown }).templates)
      ? (data as { templates: unknown[] }).templates
      : null
  if (!rows) return map
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const name =
      typeof (row as { name?: unknown }).name === "string"
        ? (row as { name: string }).name.trim()
        : ""
    if (!name) continue
    map.set(name, (row as { built?: unknown }).built === true)
  }
  return map
}

/** Live Ludus GET /templates check — fail closed for deploy paths. */
export async function assertRouterTemplateReady(
  apiKey: string,
  opts?: { userOverride?: string; template?: string },
): Promise<RouterTemplateCheck> {
  const template = opts?.template ?? LUDUS_DEFAULT_ROUTER_TEMPLATE
  try {
    const tplRes = await ludusRequest("/templates", {
      method: "GET",
      apiKey,
      timeout: 60_000,
      userOverride: opts?.userOverride,
    })
    if (tplRes.error) {
      return {
        ok: false,
        template,
        reason: "list_failed",
        error: `Refused: could not verify router template (${tplRes.error})`,
        assistant_hint:
          `Could not list Ludus templates before deploy. Fix API access, then confirm ${template} is built:true. ` +
          "Do not deploy until the router template is verified.",
      }
    }
    return checkRouterTemplateBuilt(parseBuiltMap(tplRes.data), template)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      template,
      reason: "list_failed",
      error: `Refused: could not verify router template (${msg})`,
      assistant_hint:
        `Could not list Ludus templates before deploy. Fix connectivity, then confirm ${template} is built:true.`,
    }
  }
}
