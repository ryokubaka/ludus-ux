import type { GroupObject, UserObject } from "@/lib/types"
import { parseLudusGroupList } from "@/lib/utils"

/** Ludus sometimes returns `{ result: [...] }`, a single row, or a bare array. */
export function normalizeLudusUserList(data: unknown): UserObject[] {
  if (data == null) return []
  if (Array.isArray(data)) return data as UserObject[]
  if (typeof data === "object" && "result" in data) {
    const inner = (data as { result: unknown }).result
    if (Array.isArray(inner)) return inner as UserObject[]
    if (inner && typeof inner === "object") return [inner as UserObject]
    return []
  }
  if (typeof data === "object") return [data as UserObject]
  return []
}

export function groupNamesFromList(data: unknown): string[] {
  return parseLudusGroupList<GroupObject>(data)
    .map((g) => g.groupName || g.name || g.id || "")
    .filter(Boolean)
}

export function mergeUsersByUserId(users: Iterable<UserObject>): UserObject[] {
  const byId = new Map<string, UserObject>()
  for (const u of users) {
    const id = u.userID?.trim()
    if (!id || id.toUpperCase() === "ROOT") continue
    if (!byId.has(id)) byId.set(id, u)
  }
  return [...byId.values()].sort((a, b) =>
    a.userID.localeCompare(b.userID, undefined, { sensitivity: "base" }),
  )
}
