/**
 * /api/admin/vm
 *
 * Admin-only endpoint for direct Proxmox VM management operations that are
 * not available through the Ludus API (e.g. deleting a single VM without
 * removing the entire range).
 *
 * DELETE ?proxmoxId=<id>  — stop then destroy a specific VM via pvesh
 */

import { NextRequest, NextResponse } from "next/server"
import { logAndSafeError } from "@/lib/safe-client-error"
import { finishAdminResponse, requireAdmin } from "@/lib/require-admin"
import { sshExec } from "@/lib/proxmox-ssh"
import { requireProxmoxSsh } from "@/lib/root-ssh-auth"
import { logLuxRouteAction } from "@/lib/lux-api-audit"


/** PUT ?proxmoxId=<id>&action=start|stop  — power control via pvesh */
export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const { session } = admin

  const proxmoxId = request.nextUrl.searchParams.get("proxmoxId")
  const action    = request.nextUrl.searchParams.get("action")
  if (!proxmoxId || isNaN(Number(proxmoxId))) {
    return NextResponse.json({ error: "Valid proxmoxId required" }, { status: 400 })
  }
  if (action !== "start" && action !== "stop") {
    return NextResponse.json({ error: "action must be 'start' or 'stop'" }, { status: 400 })
  }

  const ssh = requireProxmoxSsh()
  if (!ssh.ok) return NextResponse.json({ error: ssh.error }, { status: 503 })
  const { sshHost, sshPort, sshUser, sshPass } = ssh.creds

  try {
    const nodeJson = await sshExec(sshHost, sshPort, sshUser, sshPass, "pvesh get /nodes --output-format json")
    const nodes = JSON.parse(nodeJson) as Array<{ node: string }>
    if (!nodes?.length) throw new Error("No Proxmox nodes found")
    const node = nodes[0].node

    await sshExec(
      sshHost, sshPort, sshUser, sshPass,
      `pvesh create /nodes/${node}/qemu/${proxmoxId}/status/${action}`,
    )

    logLuxRouteAction(request, session, { detail: `${action} proxmoxId=${proxmoxId}` })
    return finishAdminResponse(NextResponse.json({ ok: true }), admin)
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "Operation failed" })
    return NextResponse.json({ error: logAndSafeError("admin/vm", err, "Operation failed") }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const { session } = admin

  const proxmoxId = request.nextUrl.searchParams.get("proxmoxId")
  if (!proxmoxId || isNaN(Number(proxmoxId))) {
    return NextResponse.json({ error: "Valid proxmoxId required" }, { status: 400 })
  }

  const ssh = requireProxmoxSsh()
  if (!ssh.ok) return NextResponse.json({ error: ssh.error }, { status: 503 })
  const { sshHost, sshPort, sshUser, sshPass } = ssh.creds

  try {
    // Discover the active Proxmox node
    const nodeJson = await sshExec(
      sshHost, sshPort, sshUser, sshPass,
      "pvesh get /nodes --output-format json",
    )
    const nodes = JSON.parse(nodeJson) as Array<{ node: string }>
    if (!nodes?.length) throw new Error("No Proxmox nodes found")
    const node = nodes[0].node

    // Attempt a graceful stop first (ignore failures — VM may already be off)
    await sshExec(
      sshHost, sshPort, sshUser, sshPass,
      `pvesh create /nodes/${node}/qemu/${proxmoxId}/status/stop --skiplock 1 2>/dev/null || true`,
    ).catch(() => { /* ignore */ })

    // Brief pause so Proxmox can mark it as stopped before deletion
    await new Promise((r) => setTimeout(r, 2000))

    // Destroy the VM
    await sshExec(
      sshHost, sshPort, sshUser, sshPass,
      `pvesh delete /nodes/${node}/qemu/${proxmoxId} --skiplock 1`,
    )

    logLuxRouteAction(request, session, { detail: `delete proxmoxId=${proxmoxId}` })
    return finishAdminResponse(NextResponse.json({ ok: true }), admin)
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "Operation failed" })
    return NextResponse.json({ error: logAndSafeError("admin/vm", err, "Operation failed") }, { status: 500 })
  }
}
