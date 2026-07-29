/**
 * Guidance after kicking off a long-running Ludus/LUX job (Packer build, deploy, …).
 * Models must not re-POST; they should send the user to the right LUX page and optionally poll logs.
 */

import type { PendingDestructiveCall } from "@/lib/assistant/assistant-config"

export type KickoffMonitorGuidance = {
  /** In-app path, e.g. /templates */
  pagePath: string
  /** Short label for the page */
  pageLabel: string
  /** What the assistant should tell the user + may do next (no re-POST). */
  assistantInstructions: string
  /** User-visible blurb after confirm (before optional model continue). */
  userBlurb: string
}

export function kickoffMonitorGuidance(
  pending: Pick<PendingDestructiveCall, "surface" | "method" | "path" | "operationId">,
): KickoffMonitorGuidance | null {
  const method = pending.method.toLowerCase()
  const path = pending.path

  if (pending.surface === "ludus" && method === "post" && path === "/templates") {
    return {
      pagePath: "/templates",
      pageLabel: "Templates",
      userBlurb:
        "Packer build started. Open Templates (/templates) to watch live Packer logs — builds take a while. Do not start another build for the same template.",
      assistantInstructions:
        "The Packer build ALREADY STARTED successfully. Reply to the user in 2–4 sentences: confirm it started, tell them to open the Templates page (/templates) for Packer Build Logs, and that it can take a long time. You may optionally call_ludus_api once with operationId for GET /templates/logs (e.g. getTemplateLogs) to peek at current output. NEVER call buildTemplates, NEVER POST /templates again, NEVER invent a different template name.",
    }
  }

  if (pending.surface === "ludus" && method === "post" && /^\/range\/deploy/.test(path)) {
    return {
      pagePath: "/range",
      pageLabel: "Range",
      userBlurb:
        "Range deploy started. Open Range (/range) to follow deploy logs.",
      assistantInstructions:
        "Deploy ALREADY STARTED. Tell the user to open /range for logs. Do not call deployRange / POST /range/deploy again unless they explicitly ask to re-deploy.",
    }
  }

  if (pending.surface === "lux" && method === "post" && path === "/api/templates/add") {
    return {
      pagePath: "/templates",
      pageLabel: "Templates",
      userBlurb:
        "Template registered (files on disk only). Open Templates (/templates) — it will show Not Built until you Packer-build it.",
      assistantInstructions:
        "Registration finished. Tell the user to open /templates. If they still want it usable, offer to Packer-build via Ludus buildTemplates (once) — do not call addTemplates again.",
    }
  }

  return null
}
