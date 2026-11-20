/** Keys to try for Ludus admin range creation. The range is still owned by the signed-in or impersonated user. */
export function rangeCreateKeys(userKey: string, rootKey: string | undefined): string[] {
  const user = userKey.trim()
  const root = (rootKey || "").trim()
  const keys: string[] = []
  if (user) keys.push(user)
  if (root && root !== user) keys.push(root)
  return keys
}

/** True when this key was refused because it is not an admin key. */
export function rangeCreateNeedsAdminKey(error: string | undefined, status: number): boolean {
  if (status === 401 || status === 403) return true
  return /must be an admin/i.test(error || "")
}
