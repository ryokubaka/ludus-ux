import { NextRequest, NextResponse } from "next/server"
import { resolveLudushoundSession } from "@/lib/ludushound-session"
import { writeLudushoundRangeId } from "@/lib/ludushound-ssh"
import { assertLudushoundTemplatesReady } from "@/lib/ludushound-template-assert"
import { assertRouterTemplateReady } from "@/lib/ludus-router-template-assert"
import { routerTemplateBlockMessage } from "@/lib/ludus-router-template"
import { isLudushoundCollectionInstalled } from "@/lib/ludushound-ansible-requirements"
import { ludusRequest } from "@/lib/ludus-client"
import { getSettings } from "@/lib/settings-store"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { filterLudusDeployTags } from "@/lib/ludus-deploy-tags"
import { ensureUserDefinedRolesTag } from "@/lib/ludus-deploy-only-roles"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"

type DeployBody = {
  rangeId: string
  yaml: string
  workspaceId?: string
  localRoles?: boolean
  tags?: string
  onlyRoles?: string
  force?: boolean
}

function buildLudusUrl(path: string): string {
  const settings = getSettings()
  const cleanBase = settings.ludusUrl.replace(/\/$/, "")
  const apiPath = path.startsWith("/api/v2") ? path : `/api/v2${path}`
  return `${cleanBase}${apiPath}`
}

export async function POST(request: NextRequest) {
  const ctx = await resolveLudushoundSession(request)
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as DeployBody | null
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const rangeId = body.rangeId?.trim()
  const yaml = body.yaml?.trim()
  if (!rangeId || !yaml) {
    return NextResponse.json({ error: "rangeId and yaml are required" }, { status: 400 })
  }

  if (!body.localRoles) {
    const coll = await isLudushoundCollectionInstalled(ctx.apiKey)
    if (!coll) {
      return NextResponse.json(
        {
          error:
            "bagelByt3s.ludushound collection not installed. Use Install collection on the LudusHound page first.",
          code: "collection_missing",
        },
        { status: 409 },
      )
    }
  }

  const router = await assertRouterTemplateReady(ctx.apiKey)
  if (!router.ok) {
    return NextResponse.json(
      {
        error: routerTemplateBlockMessage(router),
        code: "router_template_required",
        template: router.template,
        reason: router.reason,
      },
      { status: 409 },
    )
  }

  const tpl = await assertLudushoundTemplatesReady(ctx.apiKey, {
    yamlText: yaml,
  })
  if (!tpl.ok) {
    return NextResponse.json(
      {
        error: tpl.error,
        code: "templates_required",
        templateAudit: tpl.summary,
      },
      { status: 409 },
    )
  }

  const { apiKey: impersonateApiKey } = resolveAdminImpersonationFromRequest(ctx.session, request)
  const effectiveApiKey = impersonateApiKey || ctx.apiKey

  const ludusPath = `/range/config?rangeID=${encodeURIComponent(rangeId)}`
  const formData = new FormData()
  formData.append("file", new Blob([yaml], { type: "application/x-yaml" }), "config.yml")
  if (body.force) formData.append("force", "true")

  try {
    const cfgRes = await fetch(buildLudusUrl(ludusPath), {
      method: "PUT",
      headers: { "X-API-KEY": effectiveApiKey },
      body: formData,
      cache: "no-store",
    })
    const cfgData = await cfgRes.json().catch(() => null)
    if (!cfgRes.ok) {
      const err = cfgData?.error || `HTTP ${cfgRes.status}`
      logLuxRouteAction(request, ctx.session, { outcome: "failure", detail: err })
      return NextResponse.json({ error: `setRangeConfig failed: ${err}` }, { status: cfgRes.status || 500 })
    }
  } catch (err) {
    logLuxRouteAction(request, ctx.session, { outcome: "failure", detail: "config upload failed" })
    return NextResponse.json(
      { error: `setRangeConfig failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }

  if (body.workspaceId?.trim()) {
    await writeLudushoundRangeId(body.workspaceId.trim(), rangeId, ctx.creds).catch(() => {})
  }

  const tagList = filterLudusDeployTags(
    (body.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  )
  const onlyRolesList = (body.onlyRoles || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  const tagsWithRoles = ensureUserDefinedRolesTag(
    tagList.length ? tagList : undefined,
    onlyRolesList.length ? onlyRolesList : undefined,
  )

  const deployBody: Record<string, unknown> = {
    verbose: getSettings().ludusAnsibleVerbose,
  }
  if (tagsWithRoles?.length) deployBody.tags = tagsWithRoles.join(",")
  if (onlyRolesList.length) deployBody.only_roles = onlyRolesList.join(",")
  if (body.force) deployBody.force = true

  const dep = await ludusRequest(`/range/deploy?rangeID=${encodeURIComponent(rangeId)}`, {
    method: "POST",
    apiKey: effectiveApiKey,
    body: deployBody,
  })
  if (dep.error) {
    logLuxRouteAction(request, ctx.session, { outcome: "failure", detail: dep.error })
    return NextResponse.json(
      { error: `deploy failed: ${dep.error}`, configSet: true },
      { status: dep.status || 500 },
    )
  }

  logLuxRouteAction(request, ctx.session)
  return NextResponse.json({
    ok: true,
    rangeId,
    templateAudit: tpl.summary,
    deploy: dep.data,
  })
}
