/**
 * Ludus GET /user — caller's identity ([List user details](https://api-docs.ludus.cloud/list-user-details-24251971e0)).
 * `userID` is the alphanumeric id Ludus expects in range APIs; SSH/login hints may match `name` or `proxmoxUsername` instead.
 */

import type { UserObject } from "./types"
import { extractArray } from "./utils"

/** Home dir / sudo / GOAD workspace owner — `proxmoxUsername`, else a single-token `name`, else `userID`. */
const POSIX_USER = /^[a-zA-Z0-9_.-]+$/

export function ludusImpersonationFields(u: Pick<UserObject, "userID" | "name" | "proxmoxUsername">): {
  ludusPrincipal: string
  ludusUserId: string
  sshLogin: string
} {
  const ludusUserId = (u.userID ?? "").trim()
  const ludusPrincipal = (u.name ?? "").trim() || ludusUserId
  const px = (u.proxmoxUsername ?? "").trim()
  let sshLogin = px
  if (!sshLogin) {
    sshLogin = POSIX_USER.test(ludusPrincipal) ? ludusPrincipal : ludusUserId
  }
  return { ludusPrincipal, ludusUserId, sshLogin }
}

function profileMatchesLoginHint(user: UserObject, loginHint: string): boolean {
  const want = loginHint.trim().toLowerCase()
  if (!want) return false
  const id = user.userID.trim().toLowerCase()
  return (
    id === want ||
    (user.name ?? "").trim().toLowerCase() === want ||
    (user.proxmoxUsername ?? "").trim().toLowerCase() === want
  )
}

export function ludusCallerFromGetUser(
  raw: unknown,
  loginHint: string,
): { userId: string; user: UserObject } | undefined {
  const list = extractArray<UserObject>(raw).filter((u) => (u?.userID ?? "").trim() !== "")
  if (list.length === 0) return undefined

  const hint = loginHint.trim()
  // A named login must match even when GET /user returns a single record.
  // An empty hint is the "who am I" lookup for the caller's own key.
  const user = hint
    ? list.find((u) => profileMatchesLoginHint(u, hint))
    : list.length === 1
      ? list[0]
      : undefined

  const userId = user?.userID?.trim()
  if (!user || !userId) return undefined
  return { userId, user }
}
