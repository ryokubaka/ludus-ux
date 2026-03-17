import { NextRequest, NextResponse } from "next/server"
import { listGoadInstances, isGoadConfigured } from "@/lib/goad-ssh"
import { getSessionFromRequest } from "@/lib/session"
import { ludusGet } from "@/lib/ludus-client"
import type { RangeObject } from "@/lib/types"
import { getAllInstanceRangesLocal } from "@/lib/goad-instance-range-store"

// Must be dynamic: reads env vars + SSH at runtime.
// Without this Next.js pre-renders at build time (when LUDUS_SSH_HOST is unset)
// and serves a stale { configured: false } response for every subsequent request.
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const configured = isGoadConfigured()
  if (!configured) {
    return NextResponse.json({
      configured: false,
      instances: [],
      message: "GOAD SSH not configured. Set LUDUS_SSH_HOST in your environment.",
    })
  }

  const session = await getSessionFromRequest(request)

  // When an admin is impersonating, they send X-Impersonate-As + X-Impersonate-Apikey.
  // Use root SSH (no user creds) and filter results to only the impersonated user.
  const impersonateAs = session?.isAdmin
    ? request.headers.get("X-Impersonate-As") || null
    : null
  const impersonateApiKey = session?.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null

  // Use user's own SSH creds normally; root SSH when impersonating.
  const creds = (!impersonateAs && session?.sshPassword)
    ? { username: session.username, password: session.sshPassword }
    : undefined
  // Use impersonated user's API key for Ludus calls when impersonating.
  const effectiveApiKey = impersonateApiKey || session?.apiKey || ""
  // Username to filter instances by.
  const viewAsUsername = impersonateAs || session?.username

  try {
    // Fetch GOAD instances and all Ludus ranges in parallel.
    // The Ludus range list is used to correlate each GOAD instance to its
    // rangeID so the UI can show the correct Ludus pool name and so any
    // direct Ludus API calls can target the right range.
    const [allInstances, rangesResult] = await Promise.all([
      listGoadInstances(creds),
      ludusGet<RangeObject[]>("/range/all", { apiKey: effectiveApiKey }).catch(() => ({
        data: undefined,
        error: "could not fetch ranges",
        status: 0,
      })),
    ])

    // Build rangeNumber → rangeID map from the Ludus API response
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

    // Local DB map: instance_id → range_id (written by set-range, survives restarts)
    const localRangeMap = getAllInstanceRangesLocal()

    // Enrich each GOAD instance with its Ludus rangeID.
    // Three authoritative sources are used, in priority order:
    //
    //  0. Local SQLite DB — written by /api/goad/instances/set-range immediately on
    //     assignment.  No SSH dependency; survives container restarts.  Highest
    //     priority because it's always current and doesn't require root SSH creds.
    //  1. instance.ludusRangeId — read from .goad_range_id SSH file by listGoadInstances.
    //     Also reliable but requires root SSH write at assignment time.
    //  2. ipRange → rangeNumber → rangeID — GOAD stores the Ludus IP block as
    //     "10.<rangeNumber>.10" in instance.json; we reverse-map that to the rangeID.
    //
    // Deliberately NO "user has only one range" fallback: that heuristic caused
    // newly created Ludus ranges to appear to own existing GOAD instances that
    // were in CREATED state (no IP, no tracking file).  A CREATED instance has
    // no range assignment yet and should show as unscoped until Provide is run.
    const enriched = allInstances.map((inst) => {
      // Source 0: local DB (highest priority — no SSH dependency)
      const localRangeId = localRangeMap.get(inst.instanceId)
      if (localRangeId) return { ...inst, ludusRangeId: localRangeId }

      // Source 1: already set from the .goad_range_id SSH file
      if (inst.ludusRangeId) return inst

      // Source 2: derive from the IP range that GOAD itself records
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

    // Admins viewing their own context (not impersonating) see ALL instances so
    // they can identify and assign stale/unowned instances created outside the UI.
    // ?adminView=1 lets an impersonating admin also pull the full list (for the
    // admin management table without ending impersonation).
    const adminViewParam = request.nextUrl.searchParams.get("adminView") === "1"
    const isAdminGlobalView = session?.isAdmin && (!impersonateAs || adminViewParam)

    // Show an instance when ANY of the following is true:
    //   1. Admin in global (non-impersonating) view — see everything
    //   2. No session username (rare edge case) — show all
    //   3. File owner matches the session username exactly
    //   4. Instance has no owner recorded (workspace readable by connecting user
    //      implies they own it, or it's a legacy entry)
    //   5. The instance's IP range maps to one of the user's own Ludus ranges —
    //      covers instances deployed outside ludus-ui (e.g. goad.sh run as root
    //      on behalf of the user, or with sudo) where the file owner is "root"
    //      but the GOAD range still belongs to this user's Ludus pool.
    const myRangeIds = new Set(
      userToRangeIds.get((viewAsUsername ?? "").toLowerCase()) ?? []
    )

    const instances = isAdminGlobalView
      ? enriched
      : enriched.filter((i) => {
          if (!viewAsUsername) return true
          if (!i.ownerUserId || i.ownerUserId === viewAsUsername) return true
          if (i.ludusRangeId && myRangeIds.has(i.ludusRangeId)) return true
          return false
        })

    return NextResponse.json({ configured: true, instances })
  } catch (err) {
    // Always include configured:true so the frontend distinguishes a real SSH/runtime
    // error from "GOAD isn't set up at all".
    return NextResponse.json(
      { configured: true, instances: [], error: `Failed to list GOAD instances: ${(err as Error).message}` },
      { status: 500 }
    )
  }
}
