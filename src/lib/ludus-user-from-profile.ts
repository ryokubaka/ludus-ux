/**
 * Ludus GET /user — caller's identity ([List user details](https://api-docs.ludus.cloud/list-user-details-24251971e0)).
 * `userID` is the alphanumeric id Ludus expects in range APIs; SSH/login hints may match `name` or `proxmoxUsername` instead.
 */

import type { UserObject } from "./types"
import { extractArray } from "./utils"

export function ludusCallerFromGetUser(
  raw: unknown,
  loginHint: string,
): { userId: string; user: UserObject } | undefined {
  const list = extractArray<UserObject>(raw).filter((u) => (u?.userID ?? "").trim() !== "")
  if (list.length === 0) return undefined

  let user: UserObject | undefined
  if (list.length === 1) {
    user = list[0]
  } else {
    const want = loginHint.trim().toLowerCase()
    if (!want) return undefined
    user = list.find((u) => {
      const id = u.userID.trim().toLowerCase()
      return (
        id === want ||
        (u.name ?? "").trim().toLowerCase() === want ||
        (u.proxmoxUsername ?? "").trim().toLowerCase() === want
      )
    })
  }

  const userId = user?.userID?.trim()
  if (!user || !userId) return undefined
  return { userId, user }
}
