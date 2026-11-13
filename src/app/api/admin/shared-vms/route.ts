/**
 * GET /api/admin/shared-vms
 *
 * Returns VMs that live in Proxmox's ADMIN pool (nexus cache, Ludus Share, etc.).
 * These VMs are NOT part of any user range so they never appear in /range/all.
 * We query the Proxmox API directly via SSH (pvesh) to discover them.
 *
 * GET ?refresh=1 bypasses the short server cache for an explicit refresh.
 * Response: { vms: SharedAdminVM[] }
 */

import { NextRequest, NextResponse } from "next/server"
import { logAndSafeError } from "@/lib/ui/safe-client-error"
import { requireAdmin } from "@/lib/session/require-admin"
import { requireProxmoxSsh } from "@/lib/ssh/root-ssh-auth"
import { loadSharedAdminVmsWithMeta, type SharedAdminVM } from "@/lib/admin/shared-admin-vms"
import { applyServerTiming } from "@/lib/lux/apply-server-timing"

export type { SharedAdminVM }

export async function GET(request: NextRequest) {
  const requestStart = performance.now()
  const authStart = performance.now()
  const admin = await requireAdmin(request)
  const authMs = performance.now() - authStart
  if (!admin.ok) {
    return applyServerTiming(admin.response, {
      auth: authMs,
      total: performance.now() - requestStart,
    })
  }

  // Proxmox pvesh must use PROXMOX_SSH_* / mounted key only — never the browser session's Ludus SSH password.
  const ssh = requireProxmoxSsh()
  if (!ssh.ok) {
    return applyServerTiming(NextResponse.json({ error: ssh.error }, { status: 503 }), {
      auth: authMs,
      total: performance.now() - requestStart,
    })
  }

  try {
    const result = await loadSharedAdminVmsWithMeta(ssh.creds, {
      force: request.nextUrl.searchParams.get("refresh") === "1",
    })
    return applyServerTiming(NextResponse.json({ vms: result.vms }), {
      auth: authMs,
      cache: { dur: 0, desc: result.cacheStatus },
      ssh: result.readMs,
      total: performance.now() - requestStart,
    })
  } catch (err) {
    console.error("[shared-vms] Error:", err)
    return applyServerTiming(
      NextResponse.json(
        { error: logAndSafeError("admin/shared-vms", err, "Failed to load shared VMs") },
        { status: 500 },
      ),
      {
        auth: authMs,
        total: performance.now() - requestStart,
      },
    )
  }
}
