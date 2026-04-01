/**
 * GET /api/range/ip-plan
 *
 * Returns the next free Ludus range number (second octet in 10.N.*) based on
 * **all** ranges on the server — not only ranges visible to the current user.
 *
 * Regular users' GET /range omits other tenants' ranges; without this route the
 * deploy wizard could show 10.1.* while 10.1 is already taken globally.
 *
 * Resolution order:
 *   1. GET /range/all with LUDUS_ROOT_API_KEY (preferred)
 *   2. GET /range/all with the logged-in user's API key (often works for admins)
 *   3. GET /range with the user's key — partial list, globalPlan: false
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { ludusRequest } from "@/lib/ludus-client"
import type { RangeObject } from "@/lib/types"

export const dynamic = "force-dynamic"

function ludusRangeListFromResponse(data: unknown): RangeObject[] {
  if (data == null) return []
  if (Array.isArray(data)) return data as RangeObject[]
  if (typeof data === "object" && data !== null && "result" in data) {
    const inner = (data as { result?: unknown }).result
    if (Array.isArray(inner)) return inner as RangeObject[]
    if (inner && typeof inner === "object") return [inner as RangeObject]
  }
  if (typeof data === "object" && data !== null && "rangeID" in data) {
    return [data as RangeObject]
  }
  return []
}

/** When Ludus omits `rangeNumber`, infer the 10.N.* block from VM IPs. */
function secondOctetsFromVmIps(r: RangeObject): number[] {
  const out: number[] = []
  const vms = r.VMs || (r as { vms?: { ip?: string }[] }).vms || []
  for (const vm of vms) {
    const parts = vm.ip?.split(".")
    if (parts && parts.length >= 2) {
      const n = parseInt(parts[1], 10)
      if (!Number.isNaN(n) && n > 0 && n < 254) out.push(n)
    }
  }
  return out
}

function collectUsedSecondOctets(ranges: RangeObject[]): Set<number> {
  const used = new Set<number>()
  for (const r of ranges) {
    if (typeof r.rangeNumber === "number" && r.rangeNumber > 0) used.add(r.rangeNumber)
    for (const n of secondOctetsFromVmIps(r)) used.add(n)
  }
  return used
}

function computeNextRangeNumber(ranges: RangeObject[]): { usedRangeNumbers: number[]; nextRangeNumber: number } {
  const used = collectUsedSecondOctets(ranges)
  const usedNums = [...used].sort((a, b) => a - b)
  let n = 1
  while (used.has(n) && n < 254) n++
  return { usedRangeNumbers: usedNums, nextRangeNumber: n }
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const settings = getSettings()
  const keysToTry = [...new Set([settings.rootApiKey, session.apiKey].filter(Boolean))]

  let ranges: RangeObject[] = []
  let globalPlan = false

  const rangeListTimeout = 12_000

  for (const apiKey of keysToTry) {
    const res = await ludusRequest<unknown>("/range/all", { apiKey, timeout: rangeListTimeout })
    if (!res.error && res.data != null) {
      ranges = ludusRangeListFromResponse(res.data)
      globalPlan = true
      break
    }
  }

  // Some installs only expose the full range list on the admin API port (8081).
  if (!globalPlan && settings.rootApiKey) {
    const res = await ludusRequest<unknown>("/range/all", {
      apiKey: settings.rootApiKey,
      useAdminEndpoint: true,
      timeout: rangeListTimeout,
    })
    if (!res.error && res.data != null) {
      ranges = ludusRangeListFromResponse(res.data)
      globalPlan = true
    }
  }

  if (!globalPlan) {
    const res = await ludusRequest<unknown>("/range", { apiKey: session.apiKey, timeout: rangeListTimeout })
    if (!res.error && res.data != null) {
      ranges = ludusRangeListFromResponse(res.data)
    }
  }

  const { usedRangeNumbers, nextRangeNumber } = computeNextRangeNumber(ranges)

  return NextResponse.json({
    nextRangeNumber,
    usedRangeNumbers,
    globalPlan,
    rangeCount: ranges.length,
  })
}
