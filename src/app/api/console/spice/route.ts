import { NextRequest, NextResponse } from "next/server"
import { logAndSafeError } from "@/lib/ui/safe-client-error"
import { resolveSession } from "@/lib/session/session"
import { getSettings } from "@/lib/settings/settings-store"
import {
  proxmoxCreateSpiceProxy,
  proxmoxCreateVncProxy,
  proxmoxGetNodeForVmid,
  proxmoxLogin,
  type SpiceProxyInfo,
} from "@/lib/proxmox/proxmox-http"
import { CONSOLE_PAM_PASSWORD_REQUIRED, resolveSessionProxmoxUser } from "@/lib/session/session-proxmox-user"
import { logLuxRouteAction } from "@/lib/lux/lux-api-audit"
import { isNumericId } from "@/lib/core/validate-id"

function formatSpiceVv(
  ticket: SpiceProxyInfo & { password: string; host: string },
  vmName: string,
  proxyHost: string,
): string {
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

function vvAttachment(body: string, filename: string, consoleType?: "vnc"): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-virt-viewer",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      ...(consoleType ? { "X-Console-Type": consoleType } : {}),
    },
  })
}

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const params = request.nextUrl.searchParams
  const vmId = params.get("vmId")
  const vmName = params.get("vmName") || `vm-${vmId}`

  if (!vmId || !isNumericId(vmId)) {
    return NextResponse.json({ error: "vmId must be a numeric VM identifier" }, { status: 400 })
  }

  const password = (session.sshPassword || "").trim()
  if (!password) {
    return NextResponse.json({ error: CONSOLE_PAM_PASSWORD_REQUIRED }, { status: 503 })
  }

  const { sshHost } = getSettings()

  try {
    // Same PAM identity as in-browser noVNC. Host SSH is not used: pvesh via lux-host
    // runs as root and would hand out a ticket for every VM that account can see.
    const user = await resolveSessionProxmoxUser(session)
    const auth = await proxmoxLogin(sshHost, user, password)
    const node = await proxmoxGetNodeForVmid(sshHost, auth, vmId)
    if (!/^[a-zA-Z0-9._-]+$/.test(node)) throw new Error("Invalid Proxmox node name")

    const filename = `${vmName.replace(/[^a-zA-Z0-9._-]/g, "_")}.vv`

    try {
      const ticket = await proxmoxCreateSpiceProxy(sshHost, auth, node, vmId)
      const spicePassword = ticket.password
      const spiceHost = ticket.host
      if (spicePassword && spiceHost) {
        logLuxRouteAction(request, session, { detail: `vmId=${vmId} type=spice` })
        return vvAttachment(
          formatSpiceVv({ ...ticket, password: spicePassword, host: spiceHost }, vmName, sshHost),
          filename,
        )
      }
    } catch {
      // SPICE not available on this VM — fall back to VNC
    }

    const vnc = await proxmoxCreateVncProxy(sshHost, auth, node, vmId, { websocket: false })
    if (!vnc.port || vnc.port === "undefined") throw new Error("VNC ticket missing — is the VM powered on?")

    logLuxRouteAction(request, session, { detail: `vmId=${vmId} type=vnc` })
    return vvAttachment(formatVncVv(sshHost, vnc.port, vnc.ticket, vmName), filename, "vnc")
  } catch (err) {
    const message = (err as Error).message
    logLuxRouteAction(request, session, { outcome: "failure", detail: message.slice(0, 120) })
    return NextResponse.json(
      { error: logAndSafeError("console/spice", err, "Console access failed") },
      { status: 500 },
    )
  }
}
