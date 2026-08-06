/**
 * Server-side template gate for LudusHound deploy paths.
 */

import "server-only"

import { ludusRequest } from "@/lib/ludus-client"
import {
  auditTemplates,
  buildLudushoundRequiredTemplates,
  type TemplateAuditSummary,
} from "@/lib/ludushound-templates"

function parseTemplateInventory(data: unknown): { built: string[]; all: string[] } {
  const built: string[] = []
  const all: string[] = []
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { templates?: unknown }).templates)
      ? (data as { templates: unknown[] }).templates
      : null
  if (!rows) return { built, all }
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const name =
      typeof (row as { name?: unknown }).name === "string"
        ? (row as { name: string }).name.trim()
        : ""
    if (!name) continue
    all.push(name)
    if ((row as { built?: unknown }).built === true) built.push(name)
  }
  return { built, all }
}

export async function assertLudushoundTemplatesReady(
  apiKey: string,
  opts: { yamlText?: string; userOverride?: string },
): Promise<{ ok: true; summary: TemplateAuditSummary } | { ok: false; summary: TemplateAuditSummary; error: string }> {
  const req = buildLudushoundRequiredTemplates({
    yamlText: opts.yamlText,
  })

  const tplRes = await ludusRequest("/templates", {
    method: "GET",
    apiKey,
    timeout: 60_000,
    userOverride: opts.userOverride,
  })
  if (tplRes.error) {
    const summary = auditTemplates(req.required, [], [])
    return {
      ok: false,
      summary,
      error: `Could not verify templates: ${tplRes.error}`,
    }
  }

  const inv = parseTemplateInventory(tplRes.data)
  const summary = auditTemplates(req.required, inv.built, inv.all)
  if (!summary.ready) {
    const parts = [
      ...summary.missingAbsent.map((t) => `${t} (not installed)`),
      ...summary.missingUnbuilt.map((t) => `${t} (not built)`),
    ]
    return {
      ok: false,
      summary,
      error: `Missing Packer templates: ${parts.join(", ")}. Build them on /templates before deploying.`,
    }
  }
  return { ok: true, summary }
}
