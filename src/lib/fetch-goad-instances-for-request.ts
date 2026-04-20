import type { NextRequest } from "next/server"
import { listGoadInstances, isGoadConfigured } from "@/lib/goad-ssh"
import { ludusGet } from "@/lib/ludus-client"
import type { GoadInstance, RangeObject } from "@/lib/types"
import { getAllInstanceRangesLocal } from "@/lib/goad-instance-range-store"
import type { SessionData } from "@/lib/session"

export type GoadInstancesForRequestResult =
  | { configured: false; message: string }
  | { configured: true; instances: GoadInstance[]; error?: string }

/**
 * Shared logic for `/api/goad/instances` and `/api/goad/by-range`: list GOAD
 * workspaces visible to the session, enriched with Ludus `rangeID` the same
 * way as the instances API.
 */
export async function fetchGoadInstancesForRequest(
  request: NextRequest,
  session: SessionData | null,
): Promise<GoadInstancesForRequestResult> {
  if (!isGoadConfigured()) {
    return {
      configured: false,
      message: "GOAD SSH not configured. Set LUDUS_SSH_HOST in your environment.",
    }
  }

  const impersonateAs = session?.isAdmin
    ? request.headers.get("X-Impersonate-As") || null
    : null
  const impersonateApiKey = session?.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null

  const creds = (!impersonateAs && session?.sshPassword)
    ? { username: session.username, password: session.sshPassword }
    : undefined
  const effectiveApiKey = impersonateApiKey || session?.apiKey || ""
  const viewAsUsername = impersonateAs || session?.username

  try {
    const [allInstances, rangesResult] = await Promise.all([
      listGoadInstances(creds),
      ludusGet<RangeObject[]>("/range/all", { apiKey: effectiveApiKey }).catch(() => ({
        data: undefined,
        error: "could not fetch ranges",
        status: 0,
      })),
    ])

    const rangeNumToId = new Map<number, string>()
    const userToRangeIds = new Map<string, string[]>()
    if (rangesResult.data && Array.isArray(rangesResult.data)) {
      for (const r of rangesResult.data) {
        if (r.rangeNumber != null && r.rangeID) {
          rangeNumToId.set(r.rangeNumber, r.rangeID)
        }
        if (r.userID && r.rangeID) {
          const key = r.userID.toLowerCase()
          const existing = userToRangeIds.get(key) ?? []
          if (!existing.includes(r.rangeID)) existing.push(r.rangeID)
          userToRangeIds.set(key, existing)
        }
      }
    }

    const localRangeMap = getAllInstanceRangesLocal()

    const enriched = allInstances.map((inst) => {
      const localRangeId = localRangeMap.get(inst.instanceId)
      if (localRangeId) return { ...inst, ludusRangeId: localRangeId }

      if (inst.ludusRangeId) return inst

      if (inst.ipRange) {
        const parts = inst.ipRange.split(".")
        const rangeNum = parseInt(parts[1] ?? "", 10)
        if (!isNaN(rangeNum)) {
          const ludusRangeId = rangeNumToId.get(rangeNum)
          if (ludusRangeId) return { ...inst, ludusRangeId }
        }
      }

      return inst
    })

    const adminViewParam = request.nextUrl.searchParams.get("adminView") === "1"
    const isAdminGlobalView = session?.isAdmin && (!impersonateAs || adminViewParam)

    const myRangeIds = new Set(
      userToRangeIds.get((viewAsUsername ?? "").toLowerCase()) ?? [],
    )

    const instances = isAdminGlobalView
      ? enriched
      : enriched.filter((i) => {
          if (!viewAsUsername) return true
          if (!i.ownerUserId || i.ownerUserId === viewAsUsername) return true
          if (i.ludusRangeId && myRangeIds.has(i.ludusRangeId)) return true
          return false
        })

    return { configured: true, instances }
  } catch (err) {
    return {
      configured: true,
      instances: [],
      error: `Failed to list GOAD instances: ${(err as Error).message}`,
    }
  }
}
