import "server-only"

import { createHash } from "crypto"
import { cacheLife, cacheTag } from "next/cache"
import { ludusRequest } from "@/lib/ludus/ludus-client"
import { normalizeBlueprintList } from "@/lib/blueprints/blueprint-list-normalize"
import { buildAdminData } from "@/lib/admin/admin-data"
import { dedupeVMs } from "@/lib/ui/dashboard-vm-merge"
import {
  effectiveUsernameForMarkers,
  fetchRangeLogEnrichmentForUser,
} from "@/lib/logs/range-log-enrichment-server"
import {
  buildSnapshotsViewData,
  emptySnapshotsViewData,
  type SnapshotsViewData,
} from "@/lib/range/snapshots-view-data"
import {
  ludusCacheTag,
  ludusGlobalCacheTag,
  ludusGlobalRangeCacheTag,
  ludusRangeCacheTag,
  ludusRangeIdCacheTag,
  type LudusCacheResource,
} from "@/lib/ludus/ludus-cache-tags"
import type { ResolvedSession } from "@/lib/session/session-edge"
import type {
  AnsibleItem,
  BlueprintListItem,
  GroupObject,
  LogHistoryEntry,
  RangeAccessEntry,
  RangeObject,
  SnapshotListResponse,
  TemplateObject,
  UserObject,
} from "@/lib/core/types"
import { extractArray, parseLudusGroupList } from "@/lib/core/utils"

function apiKeyDigest(apiKey: string): string {
  // codeql[js/insufficient-password-hash] cache partition, not a stored password
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16)
}

/**
 * `"use cache"` arguments are part of the cache key. Raw API keys rotate (and
 * impersonation keys change per session), so pass a stable digest partition
 * instead and resolve the actual key from this bounded registry inside the
 * cached function.
 */
const apiKeyRegistry = new Map<string, string>()
const MAX_REGISTERED_API_KEYS = 256

function registerApiKey(apiKey: string, scopeTag: string): string {
  const partition = ludusCachePartition(apiKey, scopeTag)
  apiKeyRegistry.delete(partition)
  apiKeyRegistry.set(partition, apiKey)
  while (apiKeyRegistry.size > MAX_REGISTERED_API_KEYS) {
    const oldest = apiKeyRegistry.keys().next()
    if (oldest.done) break
    apiKeyRegistry.delete(oldest.value)
  }
  return partition
}

class MissingCacheApiKeyError extends Error {
  constructor() {
    super("Ludus cache API key is not registered for this partition")
    this.name = "MissingCacheApiKeyError"
  }
}

function apiKeyForPartition(partition: string): string {
  const apiKey = apiKeyRegistry.get(partition)
  if (!apiKey) throw new MissingCacheApiKeyError()
  return apiKey
}

function tagLudusResource(scopeTag: string, resource: LudusCacheResource): void {
  cacheTag(ludusGlobalCacheTag(resource))
  cacheTag(ludusCacheTag(scopeTag, resource))
}

function tagRangeResource(
  scopeTag: string,
  resource: Parameters<typeof ludusRangeCacheTag>[1],
  rangeId: string,
): void {
  cacheTag(ludusGlobalRangeCacheTag(resource))
  cacheTag(ludusRangeCacheTag(scopeTag, resource))
  cacheTag(ludusRangeIdCacheTag(scopeTag, resource, rangeId))
}

async function fetchAccessibleRanges(apiKey: string): Promise<RangeAccessEntry[]> {
  const r = await ludusRequest<unknown>("/ranges/accessible", { apiKey })
  const list = extractArray<RangeAccessEntry>(r.data)
  return [...list].sort((a, b) => (a.rangeNumber ?? 9999) - (b.rangeNumber ?? 9999))
}

export async function cachedAccessibleRanges(apiKey: string, scopeTag: string) {
  return cachedAccessibleRangesByPartition(registerApiKey(apiKey, scopeTag), scopeTag)
}

async function cachedAccessibleRangesByPartition(partition: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "ranges")
  cacheLife({ revalidate: 30 })
  return fetchAccessibleRanges(apiKeyForPartition(partition))
}

export async function cachedLudusVersion(apiKey: string, scopeTag: string) {
  return cachedLudusVersionByPartition(registerApiKey(apiKey, scopeTag), scopeTag)
}

async function cachedLudusVersionByPartition(partition: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "version")
  cacheLife({ revalidate: 300 })
  const r = await ludusRequest<unknown>("/version", { apiKey: apiKeyForPartition(partition) })
  if (r.error || r.data == null) {
    throw new Error(typeof r.error === "string" && r.error ? r.error : "Ludus version unavailable")
  }
  return r.data
}

export async function cachedTemplates(apiKey: string, scopeTag: string) {
  return cachedTemplatesByPartition(registerApiKey(apiKey, scopeTag), scopeTag)
}

async function cachedTemplatesByPartition(partition: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "templates")
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<unknown>("/templates", { apiKey: apiKeyForPartition(partition) })
  return extractArray<TemplateObject>(r.data)
}

export async function cachedGroups(apiKey: string, scopeTag: string) {
  return cachedGroupsByPartition(registerApiKey(apiKey, scopeTag), scopeTag)
}

async function cachedGroupsByPartition(partition: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "groups")
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<unknown>("/groups", { apiKey: apiKeyForPartition(partition) })
  return parseLudusGroupList<GroupObject>(r.data)
}

export async function cachedBlueprints(apiKey: string, scopeTag: string) {
  return cachedBlueprintsByPartition(registerApiKey(apiKey, scopeTag), scopeTag)
}

async function cachedBlueprintsByPartition(partition: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "blueprints")
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<unknown>("/blueprints", { apiKey: apiKeyForPartition(partition) })
  return normalizeBlueprintList(r.data)
}

export async function cachedAnsible(apiKey: string, scopeTag: string) {
  return cachedAnsibleByPartition(registerApiKey(apiKey, scopeTag), scopeTag)
}

async function cachedAnsibleByPartition(partition: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "ansible")
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<unknown>("/ansible", { apiKey: apiKeyForPartition(partition) })
  return extractArray<AnsibleItem>(r.data)
}

async function fetchUsersPayload(apiKey: string) {
  const [usersResult, rangesResult] = await Promise.all([
    ludusRequest<unknown>("/user/all", { apiKey }).catch(() =>
      ludusRequest<unknown>("/user", { apiKey }),
    ),
    ludusRequest<unknown>("/range/all", { apiKey }).catch(() => ({
      data: undefined,
      error: "no ranges",
      status: 0,
    })),
  ])
  const userList: UserObject[] = usersResult.data
    ? (Array.isArray(usersResult.data) ? usersResult.data : [usersResult.data as UserObject])
    : []
  const rangeMap: Record<string, string[]> = {}
  if (rangesResult.data && Array.isArray(rangesResult.data)) {
    for (const r of rangesResult.data as RangeObject[]) {
      const uid = (r.userID || r.rangeID?.split("-")[0] || "").toLowerCase()
      if (uid && r.rangeID) {
        if (!rangeMap[uid]) rangeMap[uid] = []
        if (!rangeMap[uid].includes(r.rangeID)) rangeMap[uid].push(r.rangeID)
      }
    }
  }
  return { users: userList, rangeMap }
}

export async function cachedUsers(apiKey: string, scopeTag: string) {
  return cachedUsersByPartition(registerApiKey(apiKey, scopeTag), scopeTag)
}

async function cachedUsersByPartition(partition: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "users")
  cacheLife({ revalidate: 60 })
  return fetchUsersPayload(apiKeyForPartition(partition))
}

export async function cachedAdminData(apiKey: string, scopeTag: string) {
  return cachedAdminDataByPartition(registerApiKey(apiKey, scopeTag), scopeTag)
}

async function cachedAdminDataByPartition(partition: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "admin")
  cacheLife({ revalidate: 30 })
  return buildAdminData(apiKeyForPartition(partition))
}

export async function cachedRangeStatus(apiKey: string, scopeTag: string, rangeId: string) {
  return cachedRangeStatusByPartition(registerApiKey(apiKey, scopeTag), scopeTag, rangeId)
}

async function cachedRangeStatusByPartition(partition: string, scopeTag: string, rangeId: string) {
  "use cache"
  tagRangeResource(scopeTag, "rangeStatus", rangeId)
  cacheLife({ revalidate: 15 })
  const r = await ludusRequest<RangeObject>(
    `/range?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey: apiKeyForPartition(partition) },
  )
  if (r.error || !r.data) {
    throw new Error(typeof r.error === "string" && r.error ? r.error : "Range status unavailable")
  }
  const rawVMs = r.data.VMs || (r.data as RangeObject & { vms?: RangeObject["VMs"] }).vms || []
  return { ...r.data, VMs: dedupeVMs(rawVMs) }
}

export async function cachedRangeLogHistory(apiKey: string, scopeTag: string, rangeId: string) {
  return cachedRangeLogHistoryByPartition(registerApiKey(apiKey, scopeTag), scopeTag, rangeId)
}

async function cachedRangeLogHistoryByPartition(partition: string, scopeTag: string, rangeId: string) {
  "use cache"
  tagRangeResource(scopeTag, "rangeLogHistory", rangeId)
  cacheLife({ revalidate: 30 })
  const r = await ludusRequest<unknown>(
    `/range/logs/history?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey: apiKeyForPartition(partition) },
  )
  return extractArray<LogHistoryEntry>(r.data)
}

export async function cachedRangeLogEnrichment(
  effectiveUsername: string,
  scopeTag: string,
  rangeId: string,
) {
  "use cache"
  tagRangeResource(scopeTag, "rangeLogEnrichment", rangeId)
  cacheLife({ revalidate: 30 })
  return fetchRangeLogEnrichmentForUser(rangeId, effectiveUsername)
}

/** Session-aware wrapper — derives marker username before entering cache scope. */
export async function cachedRangeLogEnrichmentForSession(
  session: ResolvedSession,
  scopeTag: string,
  rangeId: string,
) {
  return cachedRangeLogEnrichment(effectiveUsernameForMarkers(session), scopeTag, rangeId)
}

export async function cachedRangeConfig(apiKey: string, scopeTag: string, rangeId: string) {
  return cachedRangeConfigByPartition(registerApiKey(apiKey, scopeTag), scopeTag, rangeId)
}

async function cachedRangeConfigByPartition(partition: string, scopeTag: string, rangeId: string) {
  "use cache"
  tagRangeResource(scopeTag, "rangeConfig", rangeId)
  cacheLife({ revalidate: 30 })
  const r = await ludusRequest<{ result?: string }>(
    `/range/config?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey: apiKeyForPartition(partition) },
  )
  if (r.error || r.data?.result == null) return null
  return r.data.result
}

export async function cachedSnapshotsView(apiKey: string, scopeTag: string, rangeId: string) {
  return cachedSnapshotsViewByPartition(registerApiKey(apiKey, scopeTag), scopeTag, rangeId)
}

async function cachedSnapshotsViewByPartition(partition: string, scopeTag: string, rangeId: string) {
  "use cache"
  tagRangeResource(scopeTag, "snapshots", rangeId)
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<SnapshotListResponse>(
    `/snapshots/list?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey: apiKeyForPartition(partition) },
  )
  if (r.status === 404) return emptySnapshotsViewData(true)
  if (r.error || !r.data) return emptySnapshotsViewData()
  return buildSnapshotsViewData(r.data.snapshots ?? [])
}

/** Stable cache partition key — never pass raw API keys into `"use cache"` arguments. */
export function ludusCachePartition(apiKey: string, scopeTag: string): string {
  return `${scopeTag}:${apiKeyDigest(apiKey)}`
}
