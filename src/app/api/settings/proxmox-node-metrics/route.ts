/**
 * GET /api/settings/proxmox-node-metrics
 *
 * Live Proxmox cluster node stats via pvesh over SSH (same auth as GOAD / admin VM).
 * Samples are served from a short process cache; the response includes the
 * original `capturedAt` so the chart never relabels an old sample as fresh.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/session/require-admin"
import { requireProxmoxSsh } from "@/lib/ssh/root-ssh-auth"
import { getProxmoxNodeMetricsSample } from "@/lib/proxmox/proxmox-node-metrics-cache"
import { applyServerTiming } from "@/lib/lux/apply-server-timing"

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const requestStart = performance.now()
  const authStart = performance.now()
  const admin = await requireAdmin(req)
  const authMs = performance.now() - authStart
  if (!admin.ok) {
    return applyServerTiming(admin.response, {
      auth: authMs,
      total: performance.now() - requestStart,
    })
  }

  // Root `pvesh` over SSH — use only settings/env root password or mounted key.
  // Do not use `session.sshPassword` (LUX login password); it is not root@Proxmox
  // and would force password auth and skip the key, breaking key-only setups.
  const ssh = requireProxmoxSsh()
  if (!ssh.ok) {
    return applyServerTiming(NextResponse.json({ error: ssh.error }, { status: 503 }), {
      auth: authMs,
      total: performance.now() - requestStart,
    })
  }

  try {
    const result = await getProxmoxNodeMetricsSample(ssh.creds)
    return applyServerTiming(NextResponse.json(result.sample), {
      auth: authMs,
      cache: { dur: 0, desc: result.cacheStatus },
      ssh: result.readMs,
      total: performance.now() - requestStart,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return applyServerTiming(NextResponse.json({ error: message }, { status: 500 }), {
      auth: authMs,
      ssh: performance.now() - requestStart - authMs,
      total: performance.now() - requestStart,
    })
  }
}
