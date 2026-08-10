/**
 * GET /api/admin/range-vms
 *
 * Cross-range VM inventory for admin VM Management tab.
 * Merges GET /range/all VM lists with per-range config YAML template fields.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminData } from "@/lib/admin-data"
import { ludusRequest } from "@/lib/ludus-client"
import { logAndSafeError } from "@/lib/safe-client-error"
import {
  buildRangeVmInventoryRows,
  mapWithConcurrency,
  type RangeVmInventoryRow,
} from "@/lib/range-vm-inventory"
import { resolveSession } from "@/lib/session"
import { SWRCache } from "@/lib/server-cache"

const _cache = new SWRCache<{ vms: RangeVmInventoryRow[]; ts: number }>(30_000)

async function fetchRangeConfigYaml(apiKey: string, rangeId: string): Promise<string> {
  const res = await ludusRequest<{ result?: string }>(
    `/range/config?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey, timeout: 30_000 },
  )
  if (res.error || !res.data) return ""
  return typeof res.data.result === "string" ? res.data.result : ""
}

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const apiKey = session.apiKey?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: "No Ludus API key in session" }, { status: 400 })
  }

  try {
    const payload = await _cache.get(`range-vms:${apiKey}`, async () => {
      const adminData = await getAdminData(apiKey)
      const rangesWithVms = adminData.ranges.filter((r) => (r.VMs?.length ?? 0) > 0)

      const configEntries = await mapWithConcurrency(rangesWithVms, 8, async (range) => {
        const yaml = await fetchRangeConfigYaml(apiKey, range.rangeID)
        return [range.rangeID, yaml] as const
      })

      const configsByRangeId: Record<string, string> = {}
      for (const [rangeId, yaml] of configEntries) {
        configsByRangeId[rangeId] = yaml
      }

      const vms = buildRangeVmInventoryRows(
        adminData.ranges,
        configsByRangeId,
        adminData.ownership,
      )

      return { vms, ts: Date.now() }
    })

    return NextResponse.json(payload)
  } catch (err) {
    return NextResponse.json(
      { error: logAndSafeError("admin/range-vms", err, "Failed to load range VMs") },
      { status: 500 },
    )
  }
}
