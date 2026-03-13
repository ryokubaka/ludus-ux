import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { proxmoxLogin, proxmoxGetFirstNode, proxmoxCreateVncProxy } from "@/lib/proxmox-http"
import { storeVncSession } from "@/lib/vnc-token-store"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const vmId = request.nextUrl.searchParams.get("vmId")
  const vmName = request.nextUrl.searchParams.get("vmName") || `vm-${vmId}`
  if (!vmId) return NextResponse.json({ error: "vmId required" }, { status: 400 })

  const settings = getSettings()
  // Prefer dedicated Proxmox credentials; fall back to the logged-in user's SSH password.
  // For a typical Ludus deployment, root's SSH password == Proxmox root@pam password.
  const password = settings.proxmoxSshPassword || session.sshPassword || ""
  if (!password) {
    return NextResponse.json(
      { error: "No Proxmox credentials available. Set PROXMOX_SSH_PASSWORD in your .env, or log out and back in." },
      { status: 503 },
    )
  }

  const { sshHost, proxmoxSshUser: user } = settings

  try {
    // Authenticate to Proxmox API as root@pam (same credentials as SSH root).
    // The PVEAuthCookie is needed so the WebSocket proxy can authenticate the
    // upstream connection on the browser's behalf — the browser never sees it.
    const auth = await proxmoxLogin(sshHost, user, password)
    const node = await proxmoxGetFirstNode(sshHost, auth)
    const vnc = await proxmoxCreateVncProxy(sshHost, auth, node, vmId)

    // Store all connection data under a short-lived token.
    // The browser gets the token + the vncticket (needed as VNC password inside
    // the RFB protocol). The PVEAuthCookie stays server-side only.
    const token = storeVncSession({
      pveHost: sshHost,
      wsPath: vnc.wsPath,
      port: vnc.port,
      vncticket: vnc.ticket,
      pveAuthCookie: auth.cookie,
      pveUser: user,
      pvePassword: password,
      node,
      vmid: vmId,
    })

    return NextResponse.json({ token, ticket: vnc.ticket, vmName })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
