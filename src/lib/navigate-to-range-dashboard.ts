import { saveImpersonation } from "@/lib/impersonation-context"
import { ludusImpersonationFields } from "@/lib/ludus-user-from-profile"
import { syncSelectedRangeCookie } from "@/lib/sync-selected-range-cookie"
import type { UserObject } from "@/lib/types"

const RANGE_STORAGE_KEY = "lux_selected_range"

export type ImpersonationFields = ReturnType<typeof ludusImpersonationFields>

export type NavigateToRangeResult =
  | { ok: true }
  | {
      ok: false
      reason: "impersonation_manual"
      ownerUserID: string
      displayName: string
      fields: ImpersonationFields
      message?: string
    }
  | { ok: false; reason: "error"; message: string }

export function normalizeLudusUserId(id: string): string {
  return id.trim().toLowerCase()
}

/** Mirror sidebar selection — use instead of writing sessionStorage alone. */
export function persistSelectedRange(rangeId: string): void {
  sessionStorage.setItem(RANGE_STORAGE_KEY, rangeId)
  syncSelectedRangeCookie(rangeId)
  window.dispatchEvent(new Event("range-changed"))
}

export async function fetchUserApiKeyForImpersonation(
  fields: ImpersonationFields,
): Promise<{ apiKey: string } | { error: string; message?: string }> {
  const res = await fetch(
    `/api/admin/fetch-user-apikey?username=${encodeURIComponent(fields.sshLogin)}&userId=${encodeURIComponent(fields.ludusUserId)}`,
    { cache: "no-store", credentials: "same-origin" },
  )
  const data = (await res.json()) as { apiKey?: string | null; message?: string; error?: string }
  if (res.ok && data.apiKey) return { apiKey: data.apiKey }
  return {
    error: data.error ?? `Server returned ${res.status}`,
    message: data.message,
  }
}

export async function readCurrentOperatorLudusUserId(): Promise<string | null> {
  try {
    const impRes = await fetch("/api/auth/impersonate", { credentials: "same-origin" })
    if (impRes.ok) {
      const imp = (await impRes.json()) as {
        impersonating?: boolean
        ludusUserId?: string | null
        username?: string | null
      }
      if (imp.impersonating) {
        return (imp.ludusUserId || imp.username || "").trim() || null
      }
    }
    const sessRes = await fetch("/api/auth/session", { credentials: "same-origin" })
    if (sessRes.ok) {
      const sess = (await sessRes.json()) as { username?: string }
      return (sess.username || "").trim() || null
    }
  } catch {
    /* fall through */
  }
  return null
}

export function resolveOwnerUser(users: UserObject[], ownerUserID: string): UserObject | null {
  const want = normalizeLudusUserId(ownerUserID)
  if (!want) return null
  return users.find((u) => normalizeLudusUserId(u.userID) === want) ?? null
}

export function ownerUserForImpersonation(
  users: UserObject[],
  ownerUserID: string,
): Pick<UserObject, "userID" | "name" | "proxmoxUsername"> {
  const owner = resolveOwnerUser(users, ownerUserID)
  const id = ownerUserID.trim()
  return (
    owner ?? {
      userID: id,
      name: id,
      proxmoxUsername: "",
    }
  )
}

export function needsImpersonationForRangeOwner(
  ownerUserID: string,
  currentOperatorUserId: string | null,
): boolean {
  const owner = ownerUserID.trim()
  if (!owner || !currentOperatorUserId) return false
  return normalizeLudusUserId(owner) !== normalizeLudusUserId(currentOperatorUserId)
}

/**
 * Switch active range (and impersonate owner when needed), then open dashboard.
 */
export async function navigateToRangeDashboard(args: {
  rangeId: string
  ownerUserID: string
  users?: UserObject[]
  selectRange?: (rangeId: string) => void
}): Promise<NavigateToRangeResult> {
  const { rangeId, ownerUserID, users = [], selectRange } = args
  const currentOp = await readCurrentOperatorLudusUserId()

  if (needsImpersonationForRangeOwner(ownerUserID, currentOp)) {
    const userObj = ownerUserForImpersonation(users, ownerUserID)
    const fields = ludusImpersonationFields(userObj)
    const displayName = userObj.name?.trim() || userObj.userID
    const keyResult = await fetchUserApiKeyForImpersonation(fields)
    if (!("apiKey" in keyResult)) {
      return {
        ok: false,
        reason: "impersonation_manual",
        ownerUserID: ownerUserID.trim(),
        displayName,
        fields,
        message: keyResult.message || keyResult.error,
      }
    }
    try {
      await saveImpersonation({ ...fields, apiKey: keyResult.apiKey })
    } catch (err) {
      return {
        ok: false,
        reason: "error",
        message: err instanceof Error ? err.message : "Failed to start impersonation",
      }
    }
  }

  persistSelectedRange(rangeId)
  selectRange?.(rangeId)
  return { ok: true }
}
