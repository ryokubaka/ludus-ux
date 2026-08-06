import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { cleanupSoSniffAfterRangeDelete } from "@/lib/so-sniff-workflow"

/**
 * POST /api/so-sniff/cleanup
 * Body: { rangeId: string, rangeNumber?: number, vmNames?: string[] }
 * Removes sniff net1 + restores bridge ageing (Proxmox SoT). Call before range delete.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { rangeId?: string; rangeNumber?: number; vmNames?: string[] } = {}
  try {
    body = (await request.json()) as {
      rangeId?: string
      rangeNumber?: number
      vmNames?: string[]
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rangeId = body.rangeId?.trim()
  if (!rangeId) {
    return NextResponse.json({ error: "rangeId required" }, { status: 400 })
  }

  const result = await cleanupSoSniffAfterRangeDelete({
    rangeId,
    rangeNumber: body.rangeNumber,
    vmNames: body.vmNames,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.detail, ok: false }, { status: 500 })
  }
  return NextResponse.json({ ok: true, detail: result.detail })
}
