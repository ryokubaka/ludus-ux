import "server-only"

import { resolveGlobalBlueprintServiceApiKey } from "@/lib/blueprint-global-install"
import {
  groupNamesFromList,
  mergeUsersByUserId,
  normalizeLudusUserList,
} from "@/lib/ludus-share-picker-users"
import { ludusRequest } from "@/lib/ludus-client"
import type { ResolvedSession } from "@/lib/session"
import type { UserObject } from "@/lib/types"

export interface SharePickerDirectory {
  users: UserObject[]
  groups: string[]
}

function uniqueApiKeys(keys: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const key of keys) {
    const trimmed = key?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/** Keys to try for Ludus directory reads (user/all, groups) on behalf of share pickers. */
export function resolveSharePickerDirectoryApiKeys(session: ResolvedSession): string[] {
  return uniqueApiKeys([
    resolveGlobalBlueprintServiceApiKey(session),
    session.isAdmin ? session.apiKey : null,
    session.apiKey,
  ])
}

async function ludusGetFirstOk(apiKeys: string[], path: string): Promise<unknown | null> {
  for (const apiKey of apiKeys) {
    const res = await ludusRequest<unknown>(path, { apiKey })
    if (!res.error && res.data != null) return res.data
  }
  return null
}

/** Full Ludus user + group directory for blueprint (and similar) share pickers. */
export async function fetchSharePickerDirectory(
  session: ResolvedSession,
): Promise<SharePickerDirectory> {
  const apiKeys = resolveSharePickerDirectoryApiKeys(session)

  const usersPayload = await ludusGetFirstOk(apiKeys, "/user/all")
  let users = usersPayload ? mergeUsersByUserId(normalizeLudusUserList(usersPayload)) : []

  if (users.length === 0) {
    const selfPayload = await ludusGetFirstOk(apiKeys, "/user")
    users = selfPayload ? mergeUsersByUserId(normalizeLudusUserList(selfPayload)) : []
  }

  const groupsPayload = await ludusGetFirstOk(apiKeys, "/groups")
  const groups = groupsPayload
    ? groupNamesFromList(groupsPayload).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      )
    : []

  return { users, groups }
}
