/**
 * Server-only: live Ludus GET /version + GET /templates check for router Packer template.
 */

import { ludusRequest } from "@/lib/ludus-client"
import {
  checkRouterTemplateBuilt,
  extractLudusVersionString,
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

/** Live Ludus GET /version + GET /templates check — fail closed for deploy paths. */
export async function assertRouterTemplateReady(
  apiKey: string,
  opts?: {
    userOverride?: string
    template?: string
    configYaml?: string
  },
): Promise<RouterTemplateCheck> {
  try {
    const [versionRes, tplRes] = await Promise.all([
      ludusRequest("/version", {
        method: "GET",
        apiKey,
        timeout: 30_000,
        userOverride: opts?.userOverride,
      }),
      ludusRequest("/templates", {
        method: "GET",
        apiKey,
        timeout: 60_000,
        userOverride: opts?.userOverride,
      }),
    ])

    const ludusVersion = extractLudusVersionString(versionRes.data)
    const resolveOpts = {
      ludusVersion,
      pinnedTemplate: opts?.template,
      configYaml: opts?.configYaml,
    }
    const fallbackTemplate = checkRouterTemplateBuilt(new Map(), resolveOpts).template

    if (tplRes.error) {
      return {
        ok: false,
        template: fallbackTemplate,
        reason: "list_failed",
        error: `Refused: could not verify router template (${tplRes.error})`,
      }
    }

    const builtMap = parseBuiltMap(tplRes.data)
    return checkRouterTemplateBuilt(builtMap, {
      ...resolveOpts,
      registeredTemplates: builtMap,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      template: "debian-13-x64-server-template",
      reason: "list_failed",
      error: `Refused: could not verify router template (${msg})`,
    }
  }
}
