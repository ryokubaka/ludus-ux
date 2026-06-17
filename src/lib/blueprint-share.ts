import "server-only"

import { ludusBlueprintApiPath } from "@/lib/ludus-blueprint-proxy-path"
import {
  parseBlueprintBulkErrors,
  parseBlueprintBulkSuccess,
} from "@/lib/blueprint-bulk-response"
import { resolveGlobalBlueprintServiceApiKey } from "@/lib/blueprint-global-install"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { ludusRequest } from "@/lib/ludus-client"
import type { ResolvedSession } from "@/lib/session"
import type { NextRequest } from "next/server"

export interface BlueprintShareOutcome {
  userShare?: unknown
  groupShare?: unknown
  errors: Array<{ item: string; reason: string }>
  success: string[]
  httpError?: string
  status: number
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

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function mergeOutcomes(base: BlueprintShareOutcome, next: BlueprintShareOutcome): BlueprintShareOutcome {
  return {
    userShare: next.userShare ?? base.userShare,
    groupShare: next.groupShare ?? base.groupShare,
    errors: [...base.errors, ...next.errors],
    success: [...new Set([...base.success, ...next.success])],
    httpError: next.httpError ?? base.httpError,
    status: next.status || base.status,
  }
}

async function shareWithKey(
  apiKey: string,
  blueprintId: string,
  userIDs: string[],
  groupNames: string[],
): Promise<BlueprintShareOutcome> {
  let outcome: BlueprintShareOutcome = {
    errors: [],
    success: [],
    status: 200,
  }

  if (userIDs.length > 0) {
    const res = await ludusRequest<unknown>(
      ludusBlueprintApiPath(blueprintId, "share", "users"),
      { method: "POST", apiKey, body: { userIDs } },
    )
    if (res.error) {
      return {
        errors: [],
        success: [],
        httpError: res.error,
        status: res.status || 500,
      }
    }
    outcome = mergeOutcomes(outcome, {
      userShare: res.data,
      errors: parseBlueprintBulkErrors(res.data),
      success: parseBlueprintBulkSuccess(res.data),
      status: res.status,
    })
  }

  if (groupNames.length > 0) {
    const res = await ludusRequest<unknown>(
      ludusBlueprintApiPath(blueprintId, "share", "groups"),
      { method: "POST", apiKey, body: { groupNames } },
    )
    if (res.error) {
      return {
        ...outcome,
        httpError: res.error,
        status: res.status || outcome.status,
      }
    }
    outcome = mergeOutcomes(outcome, {
      groupShare: res.data,
      errors: parseBlueprintBulkErrors(res.data),
      success: parseBlueprintBulkSuccess(res.data),
      status: res.status,
    })
  }

  return outcome
}

function shouldRetryShareWithServiceKey(outcome: BlueprintShareOutcome): boolean {
  if (outcome.httpError) {
    const status = outcome.status
    if (status === 403 || status === 401 || status === 404) return true
  }
  if (outcome.errors.length > 0 && outcome.success.length === 0) return true
  return false
}

export async function shareBlueprintOnLudus(
  session: ResolvedSession,
  request: NextRequest,
  blueprintId: string,
  userIDs: string[] = [],
  groupNames: string[] = [],
): Promise<BlueprintShareOutcome> {
  const viewerKey =
    resolveAdminImpersonationFromRequest(session, request).apiKey || session.apiKey
  const serviceKey = resolveGlobalBlueprintServiceApiKey(session)
  const users = uniqueIds(userIDs)
  const groups = uniqueNames(groupNames)

  let outcome = await shareWithKey(viewerKey, blueprintId, users, groups)

  if (
    shouldRetryShareWithServiceKey(outcome) &&
    serviceKey &&
    serviceKey.trim() !== viewerKey.trim()
  ) {
    outcome = await shareWithKey(serviceKey, blueprintId, users, groups)
  }

  return outcome
}
