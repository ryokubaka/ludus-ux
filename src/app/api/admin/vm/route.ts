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
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { hasSshExecAuth } from "@/lib/root-ssh-auth"

export const dynamic = "force-dynamic"

/** PUT ?proxmoxId=<id>&action=start|stop  — power control via pvesh */
export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const proxmoxId = request.nextUrl.searchParams.get("proxmoxId")
  const action    = request.nextUrl.searchParams.get("action")
  if (!proxmoxId || isNaN(Number(proxmoxId))) {
    return NextResponse.json({ error: "Valid proxmoxId required" }, { status: 400 })
  }
  if (action !== "start" && action !== "stop") {
    return NextResponse.json({ error: "action must be 'start' or 'stop'" }, { status: 400 })
  }

  const settings = getSettings()
  const sshPass = settings.proxmoxSshPassword || session.sshPassword || ""
  if (!sshPass) {
    return NextResponse.json(
      { error: "No Proxmox credentials configured. Set PROXMOX_SSH_PASSWORD in your .env." },
      { status: 503 },
    )
  }

  const { sshHost, sshPort, proxmoxSshUser: sshUser } = settings

  try {
    const nodeJson = await sshExec(sshHost, sshPort, sshUser, sshPass, "pvesh get /nodes --output-format json")
    const nodes = JSON.parse(nodeJson) as Array<{ node: string }>
    if (!nodes?.length) throw new Error("No Proxmox nodes found")
    const node = nodes[0].node

    await sshExec(
      sshHost, sshPort, sshUser, sshPass,
      `pvesh create /nodes/${node}/qemu/${proxmoxId}/status/${action}`,
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const proxmoxId = request.nextUrl.searchParams.get("proxmoxId")
  if (!proxmoxId || isNaN(Number(proxmoxId))) {
    return NextResponse.json({ error: "Valid proxmoxId required" }, { status: 400 })
  }

  const settings = getSettings()
  const sshPass = settings.proxmoxSshPassword || session.sshPassword || ""
  if (!hasSshExecAuth(settings, session.sshPassword)) {
    return NextResponse.json(
      { error: "No Proxmox SSH auth: set PROXMOX_SSH_PASSWORD, mount a root key (./ssh), or log in with a user SSH password." },
      { status: 503 },
    )
  }

  const { sshHost, sshPort, proxmoxSshUser: sshUser } = settings

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

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
