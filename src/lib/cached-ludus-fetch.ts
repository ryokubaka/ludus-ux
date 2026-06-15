import "server-only"

import { createHash } from "crypto"
import { cacheLife, cacheTag } from "next/cache"
import { ludusRequest } from "@/lib/ludus-client"
import { buildAdminData } from "@/lib/admin-data"
import { dedupeVMs } from "@/lib/dashboard-vm-merge"
import {
  effectiveUsernameForMarkers,
  fetchRangeLogEnrichmentForUser,
} from "@/lib/range-log-enrichment-server"
import {
  buildSnapshotsViewData,
  emptySnapshotsViewData,
  type SnapshotsViewData,
} from "@/lib/snapshots-view-data"
import {
  ludusCacheTag,
  ludusGlobalCacheTag,
  ludusGlobalRangeCacheTag,
  ludusRangeCacheTag,
  type LudusCacheResource,
} from "@/lib/ludus-cache-tags"
import type { ResolvedSession } from "@/lib/session-edge"
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
} from "@/lib/types"
import { extractArray, parseLudusGroupList } from "@/lib/utils"

function apiKeyDigest(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16)
}

function tagLudusResource(scopeTag: string, resource: LudusCacheResource): void {
  cacheTag(ludusGlobalCacheTag(resource))
  cacheTag(ludusCacheTag(scopeTag, resource))
}

function tagRangeResource(scopeTag: string, resource: Parameters<typeof ludusRangeCacheTag>[1]): void {
  cacheTag(ludusGlobalRangeCacheTag(resource))
  cacheTag(ludusRangeCacheTag(scopeTag, resource))
}

async function fetchAccessibleRanges(apiKey: string): Promise<RangeAccessEntry[]> {
  const r = await ludusRequest<unknown>("/ranges/accessible", { apiKey })
  const list = extractArray<RangeAccessEntry>(r.data)
  return [...list].sort((a, b) => (a.rangeNumber ?? 9999) - (b.rangeNumber ?? 9999))
}

export async function cachedAccessibleRanges(apiKey: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "ranges")
  cacheLife({ revalidate: 30 })
  return fetchAccessibleRanges(apiKey)
}

export async function cachedLudusVersion(apiKey: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "version")
  cacheLife({ revalidate: 300 })
  const r = await ludusRequest<unknown>("/version", { apiKey })
  return r.data ?? null
}

export async function cachedTemplates(apiKey: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "templates")
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<unknown>("/templates", { apiKey })
  return extractArray<TemplateObject>(r.data)
}

export async function cachedGroups(apiKey: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "groups")
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<unknown>("/groups", { apiKey })
  return parseLudusGroupList<GroupObject>(r.data)
}

export async function cachedBlueprints(apiKey: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "blueprints")
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<unknown>("/blueprints", { apiKey })
  return extractArray<BlueprintListItem>(r.data)
}

export async function cachedAnsible(apiKey: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "ansible")
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<unknown>("/ansible", { apiKey })
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
  "use cache"
  tagLudusResource(scopeTag, "users")
  cacheLife({ revalidate: 60 })
  return fetchUsersPayload(apiKey)
}

export async function cachedAdminData(apiKey: string, scopeTag: string) {
  "use cache"
  tagLudusResource(scopeTag, "admin")
  cacheLife({ revalidate: 30 })
  return buildAdminData(apiKey)
}

export async function cachedRangeStatus(apiKey: string, scopeTag: string, rangeId: string) {
  "use cache"
  tagRangeResource(scopeTag, "rangeStatus")
  cacheLife({ revalidate: 15 })
  const r = await ludusRequest<RangeObject>(
    `/range?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey },
  )
  if (r.error || !r.data) return null
  const rawVMs = r.data.VMs || (r.data as RangeObject & { vms?: RangeObject["VMs"] }).vms || []
  return { ...r.data, VMs: dedupeVMs(rawVMs) }
}

export async function cachedRangeLogHistory(apiKey: string, scopeTag: string, rangeId: string) {
  "use cache"
  tagRangeResource(scopeTag, "rangeLogHistory")
  cacheLife({ revalidate: 30 })
  const r = await ludusRequest<unknown>(
    `/range/logs/history?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey },
  )
  return extractArray<LogHistoryEntry>(r.data)
}

export async function cachedRangeLogEnrichment(
  effectiveUsername: string,
  scopeTag: string,
  rangeId: string,
) {
  "use cache"
  tagRangeResource(scopeTag, "rangeLogEnrichment")
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
  "use cache"
  tagRangeResource(scopeTag, "rangeConfig")
  cacheLife({ revalidate: 30 })
  const r = await ludusRequest<{ result?: string }>(
    `/range/config?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey },
  )
  if (r.error || r.data?.result == null) return null
  return r.data.result
}

export async function cachedSnapshotsView(apiKey: string, scopeTag: string, rangeId: string) {
  "use cache"
  tagRangeResource(scopeTag, "snapshots")
  cacheLife({ revalidate: 60 })
  const r = await ludusRequest<SnapshotListResponse>(
    `/snapshots/list?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey },
  )
  if (r.status === 404) return emptySnapshotsViewData(true)
  if (r.error || !r.data) return emptySnapshotsViewData()
  return buildSnapshotsViewData(r.data.snapshots ?? [])
}

/** Stable cache partition key — never pass raw API keys into `"use cache"` arguments. */
export function ludusCachePartition(apiKey: string, scopeTag: string): string {
  return `${scopeTag}:${apiKeyDigest(apiKey)}`
}
