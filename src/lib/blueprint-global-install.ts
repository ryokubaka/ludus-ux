import "server-only"

import { ludusBlueprintApiPath } from "@/lib/ludus-blueprint-proxy-path"
import { findInstalledBlueprintId, buildLudusApiUrl } from "@/lib/ludus-source-client"
import { getSettings, updateSettings } from "@/lib/settings-store"
import { ludusRequest } from "@/lib/ludus-client"
import type { UserObject } from "@/lib/types"
import type { ResolvedSession } from "@/lib/session"
import { extractLudusList } from "@/lib/utils"

interface LudusUserRow {
  userID?: string
  UserID?: string
  id?: string
}

interface LudusGroupRow {
  groupName?: string
  name?: string
}

interface BlueprintAccessUserRow {
  userID?: string
}

interface BlueprintAccessGroupRow {
  groupName?: string
}

async function ludusJson<T>(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(buildLudusApiUrl(path), {
    ...init,
    headers: {
      "X-API-KEY": apiKey,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })
  const data = (await res.json().catch(() => null)) as T | null
  return { ok: res.ok, status: res.status, data }
}

/** Admin's own Ludus key — never impersonation — for one-time global source installs. */
export function resolveGlobalSourceBlueprintInstallApiKey(
  session: ResolvedSession,
): { apiKey: string | null; isAdminInstall: boolean } {
  if (session.isAdmin && session.apiKey?.trim()) {
    return { apiKey: session.apiKey.trim(), isAdminInstall: true }
  }
  return { apiKey: null, isAdminInstall: false }
}

/** Ludus key for server-side global blueprint lookup/share (survives non-admin sessions). */
export function resolveGlobalBlueprintServiceApiKey(
  session?: ResolvedSession | null,
): string | null {
  if (session?.isAdmin && session.apiKey?.trim()) {
    return session.apiKey.trim()
  }
  const stored = getSettings().blueprintOperatorApiKey?.trim()
  if (stored) return stored
  return null
}

/** Persist installing admin credentials for server-side global blueprint ops. */
export async function rememberBlueprintOperator(apiKey: string): Promise<void> {
  const key = apiKey.trim()
  if (!key) return
  updateSettings({ blueprintOperatorApiKey: key })
  const who = await ludusRequest<UserObject[]>("/user", { apiKey: key })
  const row = Array.isArray(who.data) ? who.data[0] : who.data
  const userId = row && typeof row === "object" ? String(row.userID || "").trim() : ""
  if (userId) updateSettings({ blueprintOperatorUserId: userId })
}

/** @deprecated Use rememberBlueprintOperator */
export function rememberBlueprintOperatorApiKey(apiKey: string): void {
  void rememberBlueprintOperator(apiKey)
}

async function listAllLudusUserIds(apiKey: string, ownerUserID?: string): Promise<string[]> {
  const res = await ludusJson<unknown>("/user/all", apiKey, { method: "GET" })
  const rows = res.ok ? extractLudusList<LudusUserRow>(res.data) : []
  const owner = (ownerUserID || "").trim().toLowerCase()
  const ids = new Set<string>()
  for (const row of rows) {
    const id = (row.userID || row.UserID || row.id || "").trim()
    if (!id) continue
    if (owner && id.toLowerCase() === owner) continue
    if (id.toUpperCase() === "ROOT") continue
    ids.add(id)
  }
  return [...ids]
}

async function listAllLudusGroupNames(apiKey: string): Promise<string[]> {
  const res = await ludusJson<unknown>("/groups", apiKey, { method: "GET" })
  const rows = res.ok ? extractLudusList<LudusGroupRow>(res.data) : []
  const names = new Set<string>()
  for (const row of rows) {
    const name = (row.groupName || row.name || "").trim()
    if (name) names.add(name)
  }
  return [...names]
}

async function listBlueprintAccessUserIds(apiKey: string, blueprintId: string): Promise<Set<string>> {
  const res = await ludusJson<unknown>(
    ludusBlueprintApiPath(blueprintId, "access", "users"),
    apiKey,
    { method: "GET" },
  )
  const rows = res.ok ? extractLudusList<BlueprintAccessUserRow>(res.data) : []
  return new Set(
    rows.map((r) => (r.userID || "").trim()).filter(Boolean),
  )
}

async function listBlueprintAccessGroupNames(apiKey: string, blueprintId: string): Promise<Set<string>> {
  const res = await ludusJson<unknown>(
    ludusBlueprintApiPath(blueprintId, "access", "groups"),
    apiKey,
    { method: "GET" },
  )
  const rows = res.ok ? extractLudusList<BlueprintAccessGroupRow>(res.data) : []
  return new Set(
    rows.map((r) => (r.groupName || "").trim()).filter(Boolean),
  )
}

/** Share a source blueprint with every Ludus user and group (idempotent). */
export async function ensureSourceBlueprintGloballyShared(
  adminApiKey: string,
  blueprintId: string,
  ownerUserID?: string,
): Promise<string[]> {
  const warnings: string[] = []
  const [allUsers, allGroups, sharedUsers, sharedGroups] = await Promise.all([
    listAllLudusUserIds(adminApiKey, ownerUserID),
    listAllLudusGroupNames(adminApiKey),
    listBlueprintAccessUserIds(adminApiKey, blueprintId),
    listBlueprintAccessGroupNames(adminApiKey, blueprintId),
  ])

  const newUsers = allUsers.filter((id) => {
    const lower = id.toLowerCase()
    return ![...sharedUsers].some((s) => s.toLowerCase() === lower)
  })
  if (newUsers.length > 0) {
    const res = await ludusJson<{ results?: Array<{ ok?: boolean; item?: string; reason?: string }> }>(
      ludusBlueprintApiPath(blueprintId, "share", "users"),
      adminApiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIDs: newUsers }),
      },
    )
    if (!res.ok) {
      warnings.push(`Share users failed (HTTP ${res.status})`)
    } else {
      for (const row of res.data?.results ?? []) {
        if (row.ok === false) {
          warnings.push(`Share user ${row.item ?? "?"}: ${row.reason ?? "failed"}`)
        }
      }
    }
  }

  const newGroups = allGroups.filter((name) => {
    const lower = name.toLowerCase()
    return ![...sharedGroups].some((g) => g.toLowerCase() === lower)
  })
  if (newGroups.length > 0) {
    const res = await ludusJson<{ results?: Array<{ ok?: boolean; item?: string; reason?: string }> }>(
      ludusBlueprintApiPath(blueprintId, "share", "groups"),
      adminApiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupNames: newGroups }),
      },
    )
    if (!res.ok) {
      warnings.push(`Share groups failed (HTTP ${res.status})`)
    } else {
      for (const row of res.data?.results ?? []) {
        if (row.ok === false) {
          warnings.push(`Share group ${row.item ?? "?"}: ${row.reason ?? "failed"}`)
        }
      }
    }
  }

  return warnings
}

export async function resolveExistingSourceBlueprintInstall(
  apiKey: string,
  shortName: string,
  sourceID?: string,
): Promise<string | null> {
  return findInstalledBlueprintId(apiKey, shortName, sourceID)
}

export async function finalizeGlobalSourceBlueprintInstall(
  adminApiKey: string,
  blueprintId: string,
  ownerUserID?: string,
): Promise<string[]> {
  return ensureSourceBlueprintGloballyShared(adminApiKey, blueprintId, ownerUserID)
}
