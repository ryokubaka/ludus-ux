import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { proxmoxLogin, proxmoxGetNodeForVmid, proxmoxCreateVncProxy } from "@/lib/proxmox-http"
import { CONSOLE_PAM_PASSWORD_REQUIRED, resolveSessionProxmoxUser } from "@/lib/session-proxmox-user"
import { storeVncSession } from "@/lib/vnc-token-store"
import { logAndSafeError } from "@/lib/safe-client-error"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { isNumericId } from "@/lib/validate-id"

export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const vmId = request.nextUrl.searchParams.get("vmId")
  const vmName = request.nextUrl.searchParams.get("vmName") || `vm-${vmId}`
  if (!vmId || !isNumericId(vmId)) return NextResponse.json({ error: "vmId must be a numeric VM identifier" }, { status: 400 })

  const settings = getSettings()
  const password = (session.sshPassword || "").trim()
  if (!password) {
    return NextResponse.json({ error: CONSOLE_PAM_PASSWORD_REQUIRED }, { status: 503 })
  }

  const { sshHost } = settings

  try {
    const user = await resolveSessionProxmoxUser(session)

    // Authenticate to Proxmox API as the logged-in user's PAM account.
    // The PVEAuthCookie is needed so the WebSocket proxy can authenticate the
    // upstream connection on the browser's behalf — the browser never sees it.
    const auth = await proxmoxLogin(sshHost, user, password)
    const node = await proxmoxGetNodeForVmid(sshHost, auth, vmId)
    const vnc = await proxmoxCreateVncProxy(sshHost, auth, node, vmId)

    // Store all connection data under a short-lived token.
    // The browser gets the token + the vncticket (needed as VNC password inside
    // the RFB protocol). The PVEAuthCookie stays server-side only.
    const token = storeVncSession({
      username: session.username,
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

    logLuxRouteAction(request, session, { detail: `vmId=${vmId} vmName=${vmName}` })
    return NextResponse.json({ token, ticket: vnc.ticket, vmName })
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "Console connection failed" })
    return NextResponse.json({ error: logAndSafeError("vnc-info", err, "Console connection failed") }, { status: 500 })
  }
}
