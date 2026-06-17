/**

 * Server-only prefetch utilities for TanStack Query + Next.js App Router.

 *

 * DESIGN: Non-blocking peek via in-process SWRCache (L1) backed by Next

 * `"use cache"` (L2) in cached-ludus-fetch.ts for cross-worker consistency.

 *

 * Query keys include the same `scopeTag` the browser uses (login|view).

 */



import "server-only"

import { QueryClient, dehydrate } from "@tanstack/react-query"

import type { ResolvedSession } from "@/lib/session"

import { SWRCache } from "@/lib/server-cache"

import type { AdminData } from "@/lib/admin-data"

import { queryKeys } from "@/lib/query-keys"

import type {

  AnsibleItem,

  GroupObject,

  LogHistoryEntry,

  RangeAccessEntry,

  TemplateObject,

  UserObject,

  RangeObject,

} from "@/lib/types"

import type { RangeLogMarkerEnrichment } from "@/lib/range-log-marker-types"

import type { SnapshotsViewData } from "@/lib/snapshots-view-data"

import {

  readSelectedRangeCookie,

  resolveSelectedRangeId,

} from "@/lib/selected-range-cookie"

import { effectiveScopeTagFromSession } from "@/lib/effective-scope"

import {

  cachedAccessibleRanges,

  cachedAnsible,

  cachedAdminData,

  cachedGroups,

  cachedLudusVersion,

  cachedRangeLogEnrichmentForSession,

  cachedRangeConfig,

  cachedRangeLogHistory,

  cachedRangeStatus,

  cachedSnapshotsView,

  cachedTemplates,

  cachedUsers,

} from "@/lib/cached-ludus-fetch"

import { isHttp404Error, listSources } from "@/lib/ludus-source-client"

// ── L1 SWR caches (non-blocking peek; fetchers populate L2 via cached-ludus-fetch) ──



const rangesCache = new SWRCache<RangeAccessEntry[]>(30_000)

const versionCache = new SWRCache<unknown>(5 * 60_000)

const usersCache = new SWRCache<{ users: UserObject[]; rangeMap: Record<string, string[]> }>(60_000)

const templatesCache = new SWRCache<TemplateObject[]>(60_000)

const groupsCache = new SWRCache<GroupObject[]>(60_000)

const ansibleCache = new SWRCache<AnsibleItem[]>(60_000)
const adminDataCache = new SWRCache<AdminData>(30_000)

const rangeStatusCache = new SWRCache<RangeObject | null>(15_000)

const rangeLogHistoryCache = new SWRCache<LogHistoryEntry[]>(30_000)

const rangeLogEnrichmentCache = new SWRCache<RangeLogMarkerEnrichment>(30_000)

const snapshotsViewCache = new SWRCache<SnapshotsViewData>(60_000)

const rangeConfigCache = new SWRCache<string | null>(30_000)



export type RangePrefetchSlice = "status" | "logHistory" | "logEnrichment" | "snapshots" | "config"



function rangeCacheKey(apiKey: string, rangeId: string): string {

  return `${apiKey}:${rangeId}`

}



async function peekAccessibleRanges(

  session: ResolvedSession,

): Promise<RangeAccessEntry[] | null> {

  const scopeTag = effectiveScopeTagFromSession(session)

  const effectiveApiKey = session.impersonationApiKey || session.apiKey

  return rangesCache.peek(effectiveApiKey, () => cachedAccessibleRanges(effectiveApiKey, scopeTag))

}



async function resolvePrefetchRangeId(session: ResolvedSession): Promise<string | null> {

  const accessible = await peekAccessibleRanges(session)

  const cookie = await readSelectedRangeCookie()

  return resolveSelectedRangeId(session, cookie, accessible)

}



export async function prefetchGlobal(session: ResolvedSession | null) {

  const queryClient = new QueryClient()

  try {

    if (!session) return dehydrate(queryClient)



    const scopeTag = effectiveScopeTagFromSession(session)

    const effectiveApiKey = session.impersonationApiKey || session.apiKey

    const isImpersonating = !!session.impersonationUserId



    const ranges = rangesCache.peek(effectiveApiKey, () =>

      cachedAccessibleRanges(effectiveApiKey, scopeTag),

    )



    const version = !isImpersonating

      ? versionCache.peek("global", () => cachedLudusVersion(session.apiKey, scopeTag))

      : null



    if (ranges) queryClient.setQueryData(queryKeys.accessibleRangesList(scopeTag), ranges)

    if (version) queryClient.setQueryData(queryKeys.version(scopeTag), version)

  } catch { /* best-effort */ }

  return dehydrate(queryClient)

}



export async function prefetchAdminData(session: ResolvedSession | null) {

  const queryClient = new QueryClient()

  try {

    if (!session?.isAdmin) return dehydrate(queryClient)



    const scopeTag = effectiveScopeTagFromSession(session)

    const data = adminDataCache.peek(`${session.apiKey}:${scopeTag}`, () =>
      cachedAdminData(session.apiKey, scopeTag),
    )

    if (data) queryClient.setQueryData(queryKeys.adminRangesData(scopeTag), data)

  } catch { /* best-effort */ }

  return dehydrate(queryClient)

}



export async function prefetchUsersData(session: ResolvedSession | null) {

  const queryClient = new QueryClient()

  try {

    if (!session?.isAdmin) return dehydrate(queryClient)



    const scopeTag = effectiveScopeTagFromSession(session)

    const data = usersCache.peek(session.apiKey, () => cachedUsers(session.apiKey, scopeTag))

    if (data) queryClient.setQueryData(queryKeys.users(scopeTag), data)

  } catch { /* best-effort */ }

  return dehydrate(queryClient)

}



export async function prefetchTemplatesData(session: ResolvedSession | null) {

  const queryClient = new QueryClient()

  try {

    if (!session) return dehydrate(queryClient)



    const scopeTag = effectiveScopeTagFromSession(session)

    const effectiveApiKey = session.impersonationApiKey || session.apiKey

    const templates = templatesCache.peek(effectiveApiKey, () =>

      cachedTemplates(effectiveApiKey, scopeTag),

    )

    if (templates) queryClient.setQueryData(queryKeys.templates(scopeTag), templates)

  } catch { /* best-effort */ }

  return dehydrate(queryClient)

}



export async function prefetchGroupsData(session: ResolvedSession | null) {

  const queryClient = new QueryClient()

  try {

    if (!session) return dehydrate(queryClient)



    const scopeTag = effectiveScopeTagFromSession(session)

    const effectiveApiKey = session.impersonationApiKey || session.apiKey

    const groups = groupsCache.peek(effectiveApiKey, () =>

      cachedGroups(effectiveApiKey, scopeTag),

    )

    if (groups) queryClient.setQueryData(queryKeys.groups(scopeTag), groups)

  } catch { /* best-effort */ }

  return dehydrate(queryClient)

}



export async function prefetchBlueprintsData(session: ResolvedSession | null) {

  const queryClient = new QueryClient()

  // Blueprint visibility is ACL-driven and changes when admins install/share source
  // catalogs — skip SSR hydration so the client always fetches live Ludus data.
  void session

  return dehydrate(queryClient)

}



export async function prefetchAnsibleData(session: ResolvedSession | null) {

  const queryClient = new QueryClient()

  try {

    if (!session) return dehydrate(queryClient)



    const scopeTag = effectiveScopeTagFromSession(session)

    const effectiveApiKey = session.impersonationApiKey || session.apiKey

    const ansible = ansibleCache.peek(effectiveApiKey, () =>

      cachedAnsible(effectiveApiKey, scopeTag),

    )

    if (ansible) {
      queryClient.setQueryData(queryKeys.ansible(scopeTag), {
        roles: ansible.filter((i) => (i.type || i.Type) === "role"),
        collections: ansible.filter((i) => (i.type || i.Type) === "collection"),
      })
    }

  } catch { /* best-effort */ }

  return dehydrate(queryClient)

}



export async function prefetchRangePageData(

  session: ResolvedSession | null,

  slices: RangePrefetchSlice[],

) {

  const queryClient = new QueryClient()

  try {

    if (!session || slices.length === 0) return dehydrate(queryClient)



    const scopeTag = effectiveScopeTagFromSession(session)

    const effectiveApiKey = session.impersonationApiKey || session.apiKey

    const rangeId = await resolvePrefetchRangeId(session)

    if (!rangeId) return dehydrate(queryClient)



    const cacheKey = rangeCacheKey(effectiveApiKey, rangeId)

    const enrichmentKey = `${scopeTag}:${rangeId}`



    if (slices.includes("status")) {

      const status = rangeStatusCache.peek(cacheKey, () =>

        cachedRangeStatus(effectiveApiKey, scopeTag, rangeId),

      )

      if (status) queryClient.setQueryData(queryKeys.rangeStatus(scopeTag, rangeId), status)

    }



    if (slices.includes("logHistory")) {

      const history = rangeLogHistoryCache.peek(cacheKey, () =>

        cachedRangeLogHistory(effectiveApiKey, scopeTag, rangeId),

      )

      if (history) queryClient.setQueryData(queryKeys.rangeLogHistory(scopeTag, rangeId), history)

    }



    if (slices.includes("logEnrichment")) {

      const enrichment = rangeLogEnrichmentCache.peek(enrichmentKey, () =>

        cachedRangeLogEnrichmentForSession(session, scopeTag, rangeId),

      )

      if (enrichment) {

        queryClient.setQueryData(queryKeys.rangeLogEnrichment(scopeTag, rangeId), enrichment)

      }

    }



    if (slices.includes("snapshots")) {

      const snapshots = snapshotsViewCache.peek(cacheKey, () =>

        cachedSnapshotsView(effectiveApiKey, scopeTag, rangeId),

      )

      if (snapshots) queryClient.setQueryData(queryKeys.snapshots(scopeTag, rangeId), snapshots)

    }



    if (slices.includes("config")) {

      const yaml = rangeConfigCache.peek(cacheKey, () =>

        cachedRangeConfig(effectiveApiKey, scopeTag, rangeId),

      )

      if (yaml != null) queryClient.setQueryData(queryKeys.rangeConfig(scopeTag, rangeId), yaml)

    }

  } catch { /* best-effort */ }

  return dehydrate(queryClient)

}



export async function prefetchDashboardData(session: ResolvedSession | null) {

  return prefetchRangePageData(session, ["status", "logHistory", "logEnrichment"])

}



export async function prefetchLogsData(session: ResolvedSession | null) {

  return prefetchRangePageData(session, ["logHistory", "logEnrichment"])

}



export async function prefetchSnapshotsData(session: ResolvedSession | null) {

  return prefetchRangePageData(session, ["snapshots"])

}



/** Testing page — same range-scoped log data as /logs. */

export async function prefetchTestingData(session: ResolvedSession | null) {

  return prefetchRangePageData(session, ["logHistory", "logEnrichment"])

}



export async function prefetchRangeConfigData(session: ResolvedSession | null) {

  return prefetchRangePageData(session, ["config", "status"])

}



export async function prefetchSourcesData(session: ResolvedSession | null) {

  const queryClient = new QueryClient()

  try {

    if (!session) return dehydrate(queryClient)

    const scopeTag = effectiveScopeTagFromSession(session)

    const effectiveApiKey = session.impersonationApiKey || session.apiKey

    try {

      const sources = await listSources(effectiveApiKey)

      queryClient.setQueryData(queryKeys.sources(scopeTag), { sources, available: true })

    } catch (err) {

      if (!isHttp404Error(err)) throw err

      queryClient.setQueryData(queryKeys.sources(scopeTag), { sources: [], available: false })

    }

  } catch { /* best-effort */ }

  return dehydrate(queryClient)

}


