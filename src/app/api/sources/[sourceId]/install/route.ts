import { NextRequest, NextResponse } from "next/server"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import {
  finalizeGlobalSourceBlueprintInstall,
  rememberBlueprintOperator,
  resolveExistingSourceBlueprintInstall,
  resolveGlobalBlueprintServiceApiKey,
  resolveGlobalSourceBlueprintInstallApiKey,
} from "@/lib/blueprint-global-install"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { revalidateAfterSourceMutation } from "@/lib/ludus-cache-revalidate"
import { installFromSource, isSourcesApiUnavailableError, type SourceInstallSelection } from "@/lib/ludus-source-client"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { requireSourcesSession } from "@/lib/ludus-sources-route-helpers"
import { logAndSafeError } from "@/lib/safe-client-error"

export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { session, apiKey } = await requireSourcesSession(request)
  if (!session || !apiKey) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { sourceId } = await params
  if (!sourceId?.trim()) {
    return NextResponse.json({ error: "sourceId is required" }, { status: 400 })
  }

  let selection: SourceInstallSelection = {}
  try {
    const body = await request.json()
    selection = body?.selection ?? body ?? {}
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const hasItems =
    (selection.blueprints?.length ?? 0) > 0 ||
    (selection.templates?.length ?? 0) > 0 ||
    (selection.localRoles?.length ?? 0) > 0 ||
    (selection.localCollections?.length ?? 0) > 0

  if (!hasItems) {
    return NextResponse.json({ error: "No items selected for install" }, { status: 400 })
  }

  try {
    const viewerApiKey =
      resolveAdminImpersonationFromRequest(session, request).apiKey || apiKey
    const { apiKey: adminInstallKey, isAdminInstall } =
      resolveGlobalSourceBlueprintInstallApiKey(session)
    const globalLookupApiKey =
      resolveGlobalBlueprintServiceApiKey(session) || adminInstallKey || viewerApiKey
    const blueprintNames = selection.blueprints ?? []
    const installingBlueprints = blueprintNames.length > 0

    if (installingBlueprints && adminInstallKey) {
      await rememberBlueprintOperator(adminInstallKey)
    }

    if (installingBlueprints && !isAdminInstall) {
      const missing: string[] = []
      const repairWarnings: string[] = []
      for (const name of blueprintNames) {
        const existingForViewer = await resolveExistingSourceBlueprintInstall(
          viewerApiKey,
          name,
          sourceId,
        )
        if (existingForViewer) continue
        const existingGlobal = await resolveExistingSourceBlueprintInstall(
          globalLookupApiKey,
          name,
          sourceId,
        )
        if (existingGlobal) {
          repairWarnings.push(
            ...(await finalizeGlobalSourceBlueprintInstall(globalLookupApiKey, existingGlobal)),
          )
          continue
        }
        missing.push(name)
      }
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error:
              "Community source blueprints must be installed once by a Ludus administrator for all users. Ask an admin to install from Sources or Blueprints.",
          },
          { status: 403 },
        )
      }
      const scopeTag = effectiveScopeTagFromSession(session)
      revalidateAfterSourceMutation(scopeTag)
      logLuxRouteAction(request, session, {
        outcome: "success",
        detail: `install-source=${sourceId} access-sync`,
      })
      return NextResponse.json({
        warnings: repairWarnings,
        data: { result: "Blueprint access synced for all users" },
      })
    }

    const installApiKey =
      installingBlueprints && isAdminInstall && adminInstallKey ? adminInstallKey : apiKey

    const { warnings, data } = await installFromSource(installApiKey, sourceId, selection)

    const shareWarnings: string[] = []
    if (installingBlueprints && globalLookupApiKey) {
      for (const name of blueprintNames) {
        const blueprintId = await resolveExistingSourceBlueprintInstall(
          globalLookupApiKey,
          name,
          sourceId,
        )
        if (blueprintId) {
          shareWarnings.push(
            ...(await finalizeGlobalSourceBlueprintInstall(globalLookupApiKey, blueprintId)),
          )
        }
      }
    }

    const scopeTag = effectiveScopeTagFromSession(session)
    revalidateAfterSourceMutation(scopeTag)
    logLuxRouteAction(request, session, { outcome: "success", detail: `install-source=${sourceId}` })
    return NextResponse.json({ warnings: [...warnings, ...shareWarnings], data })
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: `install-source=${sourceId}` })
    if (isSourcesApiUnavailableError(err)) {
      return NextResponse.json(
        { error: "Sources API requires Ludus 2.2.0 or newer." },
        { status: 404 },
      )
    }
    const message = logAndSafeError("sources/install", err, "Source install failed")
    const status = /HTTP 404/i.test((err as Error).message) ? 404 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
