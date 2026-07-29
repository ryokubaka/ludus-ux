/**
 * DELETE /api/templates/delete
 *
 * Removes a Packer template from the Ludus host as root SSH.
 * Ludus DELETE /template/{name} returns HTTP 200 for shared /packer/ installs
 * but refuses to delete the folder ("included template") — so LUX always removes
 * dirs under packer/ and users/.../packer/ via SSH after (or instead of) the API call.
 *
 * Disk dir often uses the catalog name without `-template` while Ludus lists the
 * Packer `vm_name` (`*-template`). Cleanup tries both aliases and verifies via GET /templates.
 */

import { NextRequest, NextResponse } from "next/server"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { revalidateLudusResource, revalidateLudusScopeResource } from "@/lib/ludus-cache-revalidate"
import { ludusRequest } from "@/lib/ludus-client"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { resolveSession } from "@/lib/session"
import { sshExec } from "@/lib/goad-ssh"
import { resolveLudusInstallPath } from "@/lib/runtime-paths"
import {
  buildLudusTemplateDeleteCmd,
  isLudusTemplateDeleteRefused,
  templateDirNameAliases,
} from "@/lib/template-packer-paths"
import { logAndSafeError } from "@/lib/safe-client-error"
import type { TemplateObject } from "@/lib/types"

const NAME_RE = /^[a-zA-Z0-9._-]{1,120}$/

function templateStillListed(
  templates: TemplateObject[] | null | undefined,
  name: string,
): boolean {
  if (!templates?.length) return false
  const aliases = new Set(templateDirNameAliases(name).map((a) => a.toLowerCase()))
  return templates.some((t) => aliases.has((t.name || "").trim().toLowerCase()))
}

export async function DELETE(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { name?: string } | null
  const name = body?.name?.trim() || ""
  if (!NAME_RE.test(name)) {
    return NextResponse.json(
      { error: "Invalid template name. Use only letters, numbers, hyphens, underscores, and dots." },
      { status: 400 },
    )
  }

  const imp = resolveAdminImpersonationFromRequest(session, request)
  const apiKey = (imp.apiKey || session.apiKey || "").trim()
  if (!apiKey) {
    return NextResponse.json({ error: "No Ludus API key in session — sign in again." }, { status: 400 })
  }

  // Best-effort Ludus API first (cleans Proxmox VM when built; may refuse packer dirs).
  let apiMessage = ""
  let apiRefused = false
  const api = await ludusRequest<{ result?: string; error?: string }>(
    `/template/${encodeURIComponent(name)}`,
    { method: "DELETE", apiKey, timeout: 60_000 },
  )
  if (api.error) {
    // 404 = already gone from Ludus view; still try disk cleanup.
    if (api.status !== 404) {
      apiMessage = api.error
    }
  } else {
    const resultText =
      (typeof api.data === "object" && api.data && "result" in api.data
        ? String((api.data as { result?: string }).result || "")
        : "") || JSON.stringify(api.data ?? "")
    apiMessage = resultText
    apiRefused = isLudusTemplateDeleteRefused(resultText)
  }

  const ludusRoot = resolveLudusInstallPath()
  const rmCmd = buildLudusTemplateDeleteCmd(ludusRoot, name)
  let sshOk = false
  let sshOut = ""
  try {
    const rm = await sshExec(`${rmCmd} 2>&1`)
    sshOut = (rm.stdout + rm.stderr).trim()
    sshOk = rm.code === 0
  } catch (err) {
    sshOut = logAndSafeError("templates/delete", err, "SSH template delete failed")
  }

  if (!sshOk && apiRefused) {
    logLuxRouteAction(request, session, {
      outcome: "failure",
      detail: `template=${name} api-refused ssh-failed`,
    })
    return NextResponse.json(
      {
        error:
          `Ludus refused to delete "${name}" (shared packer) and root SSH cleanup failed.\n` +
          `API: ${apiMessage || "(none)"}\nSSH: ${sshOut || "(none)"}`,
      },
      { status: 502 },
    )
  }

  if (!sshOk && api.error && api.status !== 404) {
    logLuxRouteAction(request, session, {
      outcome: "failure",
      detail: `template=${name} api+ssh failed`,
    })
    return NextResponse.json(
      { error: apiMessage || sshOut || "Template delete failed" },
      { status: api.status || 502 },
    )
  }

  // Ludus soft-refuse returns HTTP 200 with files still on disk — confirm list is clear.
  const listed = await ludusRequest<TemplateObject[]>("/templates", {
    apiKey,
    timeout: 30_000,
  })
  if (!listed.error && templateStillListed(listed.data, name)) {
    logLuxRouteAction(request, session, {
      outcome: "failure",
      detail: `template=${name} still listed after ssh cleanup`,
    })
    return NextResponse.json(
      {
        error:
          `Template "${name}" still appears in Ludus after disk cleanup. ` +
          `Ludus often soft-refuses shared /packer/ deletes ("included template") even for user-added templates — ` +
          `SSH tried aliases ${templateDirNameAliases(name).join(", ")}. ` +
          `SSH: ${sshOut || "(none)"}`,
      },
      { status: 502 },
    )
  }

  const scopeTag = effectiveScopeTagFromSession(session)
  revalidateLudusResource("templates")
  revalidateLudusScopeResource(scopeTag, "templates")

  logLuxRouteAction(request, session, {
    outcome: "success",
    detail: `template=${name}${apiRefused ? " (ssh cleanup after packer refuse)" : ""}`,
  })

  return NextResponse.json({
    ok: true,
    message: apiRefused
      ? `Template "${name}" removed from disk (Ludus soft-refused API delete for shared packer path — not a stock template)`
      : `Template "${name}" deleted`,
    apiMessage: apiMessage || undefined,
  })
}
