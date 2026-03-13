import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"

export const dynamic = "force-dynamic"

interface SpiceTicket {
  type?: string
  password: string
  proxy?: string
  host: string
  "tls-port"?: number
  port?: number
  ca?: string
  "host-subject"?: string
  "release-cursor"?: string
  "secure-attention"?: string
  "toggle-fullscreen"?: string
}

interface VncTicket {
  port: string
  ticket: string
  upid?: string
}

function formatSpiceVv(ticket: SpiceTicket, vmName: string, proxyHost: string): string {
  // Keep this as close to what Proxmox itself generates as possible.
  // Extra fields like tls-ciphers, enable-smartcard, enable-usb-autoshare, fullscreen
  // are NOT emitted by Proxmox and can interfere with SPICE agent channel negotiation
  // (breaking clipboard sync and dynamic window scaling).
  const lines = [
    "[virt-viewer]",
    `password=${ticket.password}`,
  ]
  if (ticket["host-subject"]) lines.push(`host-subject=${ticket["host-subject"]}`)
  lines.push(`secure-attention=${ticket["secure-attention"] || "Ctrl+Alt+Ins"}`)
  lines.push(`toggle-fullscreen=${ticket["toggle-fullscreen"] || "Shift+F11"}`)
  if (ticket["tls-port"]) lines.push(`tls-port=${ticket["tls-port"]}`)
  if (ticket.port) lines.push(`port=${ticket.port}`)
  lines.push("type=spice")
  lines.push(`release-cursor=${ticket["release-cursor"] || "Ctrl+Alt+R"}`)
  // proxy= is required — without it virt-viewer tries to resolve "pvespiceproxy" directly
  const proxyUrl = ticket.proxy || `http://${proxyHost}:3128`
  lines.push(`proxy=${proxyUrl}`)
  if (ticket.ca) lines.push(`ca=${ticket.ca.replace(/\n/g, "\\n")}`)
  lines.push("delete-this-file=1")
  lines.push(`title=${vmName}`)
  // resize-guest=1 tells virt-viewer to send resolution-change hints to the guest
  // when the window is resized. Requires spice-vdagent/virtio-win in the guest OS.
  lines.push("resize-guest=1")
  lines.push(`host=${ticket.host}`)
  return lines.join("\n") + "\n"
}

async function requestSpiceTicket(
  sshHost: string,
  sshPort: number,
  sshUser: string,
  sshPass: string,
  node: string,
  vmId: string
): Promise<SpiceTicket> {
  const commands = [
    // Preferred: include explicit proxy at ticket creation (closer to Proxmox UI flow).
    `pvesh create /nodes/${node}/qemu/${vmId}/spiceproxy --proxy http://${sshHost}:3128 --output-format json`,
    // Fallback: some environments work better with Proxmox defaults.
    `pvesh create /nodes/${node}/qemu/${vmId}/spiceproxy --output-format json`,
  ]

  let lastError: Error | null = null
  for (const cmd of commands) {
    try {
      const spiceJson = await sshExec(sshHost, sshPort, sshUser, sshPass, cmd)
      const ticket = JSON.parse(spiceJson) as SpiceTicket
      if (ticket?.password) return ticket
      lastError = new Error("No SPICE password in ticket")
    } catch (err) {
      lastError = err as Error
    }
  }
  throw lastError || new Error("Failed to create SPICE ticket")
}

function formatVncVv(host: string, port: string, ticket: string, vmName: string): string {
  return [
    "[virt-viewer]",
    "type=vnc",
    `host=${host}`,
    `port=${port}`,
    `password=${ticket}`,
    `title=${vmName}`,
    "fullscreen=0",
    "delete-this-file=1",
    "toggle-fullscreen=shift+f11",
    "release-cursor=ctrl+alt+r",
  ].join("\n") + "\n"
}


export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const params = request.nextUrl.searchParams
  const vmId = params.get("vmId")
  const vmName = params.get("vmName") || `vm-${vmId}`

  if (!vmId) {
    return NextResponse.json({ error: "vmId is required" }, { status: 400 })
  }

  const settings = getSettings()

  // Prefer dedicated Proxmox credentials; fall back to the logged-in user's SSH password.
  const sshPass = settings.proxmoxSshPassword || session.sshPassword || ""
  if (!sshPass) {
    return NextResponse.json(
      { error: "No Proxmox credentials available. Set PROXMOX_SSH_PASSWORD in your .env, or log out and back in." },
      { status: 503 }
    )
  }

  const { sshHost, sshPort, proxmoxSshUser: sshUser } = settings

  try {
    // Discover Proxmox node (login shell ensures pvesh is on PATH)
    const nodeJson = await sshExec(sshHost, sshPort, sshUser, sshPass,
      "pvesh get /nodes --output-format json")
    const nodes = JSON.parse(nodeJson) as Array<{ node: string }>
    if (!nodes?.length) throw new Error("No Proxmox nodes found")
    const node = nodes[0].node

    // Try SPICE first
    try {
      const ticket = await requestSpiceTicket(sshHost, sshPort, sshUser, sshPass, node, vmId)

      const vvContent = formatSpiceVv(ticket, vmName, sshHost)
      const filename = `${vmName.replace(/[^a-zA-Z0-9._-]/g, "_")}.vv`
      return new Response(vvContent, {
        headers: {
          "Content-Type": "application/x-virt-viewer",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      })
    } catch {
      // SPICE not available on this VM — fall back to VNC
    }

    // VNC fallback
    const vncJson = await sshExec(sshHost, sshPort, sshUser, sshPass,
      `pvesh create /nodes/${node}/qemu/${vmId}/vncproxy --output-format json`)
    const vnc = JSON.parse(vncJson) as VncTicket
    if (!vnc?.ticket) throw new Error("VNC ticket missing — is the VM powered on?")

    const vvContent = formatVncVv(sshHost, vnc.port, vnc.ticket, vmName)
    const filename = `${vmName.replace(/[^a-zA-Z0-9._-]/g, "_")}.vv`
    return new Response(vvContent, {
      headers: {
        "Content-Type": "application/x-virt-viewer",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Console-Type": "vnc",
      },
    })
  } catch (err) {
    const message = (err as Error).message
    return NextResponse.json(
      { error: `Console access failed: ${message}` },
      { status: 500 }
    )
  }
}
