/**
 * GET /api/admin/shared-vms
 *
 * Returns VMs that live in Proxmox's ADMIN pool (nexus cache, Ludus Share, etc.).
 * These VMs are NOT part of any user range so they never appear in /range/all.
 * We query the Proxmox API directly via SSH (pvesh) to discover them.
 *
 * Response: { vms: SharedAdminVM[] }
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { hasSshExecAuth } from "@/lib/root-ssh-auth"

export const dynamic = "force-dynamic"

export interface SharedAdminVM {
  vmid: number
  name: string
  node: string
  status: "running" | "stopped" | "unknown"
  ip: string
  serviceType: "nexus" | "share" | "other"
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
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
    // 1. Get ADMIN pool members (vmid + node)
    const poolJson = await sshExec(
      sshHost, sshPort, sshUser, sshPass,
      "pvesh get /pools/ADMIN --output-format json 2>/dev/null || echo '{}'",
    )

    let members: Array<{ vmid: number; node?: string; type?: string }> = []
    try {
      const pool = JSON.parse(poolJson) as { members?: Array<{ vmid: number; node?: string; type?: string }> }
      members = (pool.members || []).filter((m) => m.type === "qemu" || !m.type)
    } catch {
      return NextResponse.json({ vms: [] })
    }

    if (members.length === 0) return NextResponse.json({ vms: [] })

    // 2. For each member, get current status (name, power state, IP via guest agent)
    const vms: SharedAdminVM[] = []

    for (const member of members) {
      const { vmid } = member

      // Determine node — use member.node if present, else discover from /nodes
      let node = member.node
      if (!node) {
        try {
          const nodesJson = await sshExec(
            sshHost, sshPort, sshUser, sshPass,
            "pvesh get /nodes --output-format json",
          )
          const nodes = JSON.parse(nodesJson) as Array<{ node: string }>
          node = nodes[0]?.node ?? "pve"
        } catch {
          node = "pve"
        }
      }

      let name = `vmid-${vmid}`
      let status: "running" | "stopped" | "unknown" = "unknown"
      let ip = ""

      try {
        const statusJson = await sshExec(
          sshHost, sshPort, sshUser, sshPass,
          `pvesh get /nodes/${node}/qemu/${vmid}/status/current --output-format json`,
        )
        const s = JSON.parse(statusJson) as { name?: string; status?: string }
        name = s.name ?? name
        status = s.status === "running" ? "running" : s.status === "stopped" ? "stopped" : "unknown"
      } catch { /* leave defaults */ }

      // Try to get IP via QEMU guest agent (may fail if VM is off or no agent)
      try {
        const netJson = await sshExec(
          sshHost, sshPort, sshUser, sshPass,
          `pvesh get /nodes/${node}/qemu/${vmid}/agent/network-get-interfaces --output-format json 2>/dev/null || echo '{}'`,
        )
        const net = JSON.parse(netJson) as {
          result?: Array<{ "ip-addresses"?: Array<{ "ip-address"?: string; "ip-address-type"?: string }> }>
        }
        // Find first non-loopback IPv4 address
        for (const iface of net.result ?? []) {
          for (const addr of iface["ip-addresses"] ?? []) {
            const a = addr["ip-address"] ?? ""
            if (addr["ip-address-type"] === "ipv4" && !a.startsWith("127.") && !a.startsWith("169.254")) {
              ip = a
              break
            }
          }
          if (ip) break
        }
      } catch { /* no IP available */ }

      let serviceType: "nexus" | "share" | "other" = "other"
      if (/nexus/i.test(name)) serviceType = "nexus"
      else if (/(^|-)share($|-)/i.test(name) || /ludus.?share/i.test(name)) serviceType = "share"

      vms.push({ vmid, name, node, status, ip, serviceType })
    }

    return NextResponse.json({ vms })
  } catch (err) {
    console.error("[shared-vms] Error:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
