import "server-only"

import { ludusBlueprintApiPath } from "@/lib/ludus-blueprint-proxy-path"
import { blueprintTypeKey } from "@/lib/blueprint-list-consolidate"
import {
  isSourceCatalogBlueprintId,
  normalizeBlueprintList,
} from "@/lib/blueprint-list-normalize"
import { resolveGlobalBlueprintServiceApiKey } from "@/lib/blueprint-global-install"
import { ludusRequest } from "@/lib/ludus-client"
import type { ResolvedSession } from "@/lib/session"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import type { NextRequest } from "next/server"

export interface BlueprintDeleteAttempt {
  blueprintId: string
  ok: boolean
  status: number
  error?: string
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

async function ludusDeleteBlueprint(
  apiKey: string,
  blueprintId: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const path = ludusBlueprintApiPath(blueprintId)
  const result = await ludusRequest(path, { method: "DELETE", apiKey })
  if (result.error) {
    return { ok: false, status: result.status || 500, error: result.error }
  }
  return { ok: true, status: result.status || 200 }
}

async function listBlueprintIdsForSlug(apiKey: string, slug: string): Promise<string[]> {
  const listed = await ludusRequest<unknown>("/blueprints", { apiKey })
  if (listed.error || !listed.data) return []
  const want = slug.trim().toLowerCase()
  if (!want) return []
  return normalizeBlueprintList(listed.data)
    .filter((bp) => blueprintTypeKey(bp) === want)
    .map((bp) => (bp.id || bp.blueprintID || "").trim())
    .filter(Boolean)
}

async function deleteWithKeyFallback(
  apiKey: string,
  blueprintId: string,
  fallbackKeys: string[],
): Promise<{ ok: boolean; status: number; error?: string }> {
  const keys = uniqueIds([apiKey, ...fallbackKeys])
  let last: { ok: boolean; status: number; error?: string } = {
    ok: false,
    status: 404,
    error: "Blueprint not found",
  }
  for (const key of keys) {
    const attempt = await ludusDeleteBlueprint(key, blueprintId)
    if (attempt.ok) return attempt
    last = attempt
    if (attempt.status !== 404 && attempt.status !== 403) return attempt
  }
  return last
}

export async function deleteBlueprintsOnLudus(
  session: ResolvedSession,
  request: NextRequest,
  blueprintId: string,
  aliasIds: string[] = [],
): Promise<{ attempts: BlueprintDeleteAttempt[]; anyOk: boolean }> {
  const viewerKey =
    resolveAdminImpersonationFromRequest(session, request).apiKey || session.apiKey
  const serviceKey = resolveGlobalBlueprintServiceApiKey(session)
  const isSource = isSourceCatalogBlueprintId(blueprintId)
  const fallbackKeys =
    session.isAdmin && isSource && serviceKey
      ? uniqueIds([serviceKey, session.apiKey])
      : serviceKey && serviceKey !== viewerKey
        ? [serviceKey]
        : []

  let targetIds = uniqueIds([blueprintId, ...aliasIds])
  if (isSource) {
    const slug = blueprintTypeKey({ id: blueprintId, blueprintID: blueprintId })
    if (slug && serviceKey) {
      const discovered = await listBlueprintIdsForSlug(serviceKey, slug)
      targetIds = uniqueIds([...targetIds, ...discovered])
    }
  }

  const attempts: BlueprintDeleteAttempt[] = []
  for (const id of targetIds) {
    const result = await deleteWithKeyFallback(viewerKey, id, fallbackKeys)
    attempts.push({
      blueprintId: id,
      ok: result.ok,
      status: result.status,
      error: result.error,
    })
  }

  return { attempts, anyOk: attempts.some((a) => a.ok) }
}
