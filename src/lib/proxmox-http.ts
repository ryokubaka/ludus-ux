/**
 * Direct HTTP calls to the Proxmox VE API.
 *
 * Used for in-browser VNC — authenticates as root@pam with a password (PAM).
 * SSH key auth is not used here; SPICE / pvesh paths use SSH separately.
 *
 * TLS verification is already disabled globally by ludus-client.ts
 * (NODE_TLS_REJECT_UNAUTHORIZED=0) when LUDUS_VERIFY_TLS != "true".
 */

export interface ProxmoxAuth {
  /** PVEAuthCookie value (must be sent as Cookie header on subsequent calls) */
  cookie: string
  /** CSRFPreventionToken header value */
  csrf: string
}

export async function proxmoxLogin(
  host: string,
  user: string,
  password: string,
): Promise<ProxmoxAuth> {
  const body = new URLSearchParams({
    username: user.includes("@") ? user : `${user}@pam`,
    password,
  })

  const res = await fetch(`https://${host}:8006/api2/json/access/ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Proxmox login failed (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    data?: { ticket?: string; CSRFPreventionToken?: string }
  }
  const cookie = json.data?.ticket
  const csrf = json.data?.CSRFPreventionToken
  if (!cookie || !csrf) throw new Error("Proxmox login response missing ticket or CSRF token")
  return { cookie, csrf }
}

export async function proxmoxGetFirstNode(host: string, auth: ProxmoxAuth): Promise<string> {
  const res = await fetch(`https://${host}:8006/api2/json/nodes`, {
    headers: {
      Cookie: `PVEAuthCookie=${auth.cookie}`,
      CSRFPreventionToken: auth.csrf,
    },
  })
  if (!res.ok) throw new Error(`Failed to list Proxmox nodes (HTTP ${res.status})`)
  const json = (await res.json()) as { data?: Array<{ node: string }> }
  const node = json.data?.[0]?.node
  if (!node) throw new Error("No Proxmox nodes found")
  return node
}

export interface VncProxyInfo {
  port: string
  ticket: string
  wsPath: string
}

export async function proxmoxCreateVncProxy(
  host: string,
  auth: ProxmoxAuth,
  node: string,
  vmid: string,
): Promise<VncProxyInfo> {
  const res = await fetch(
    `https://${host}:8006/api2/json/nodes/${node}/qemu/${vmid}/vncproxy`,
    {
      method: "POST",
      headers: {
        Cookie: `PVEAuthCookie=${auth.cookie}`,
        CSRFPreventionToken: auth.csrf,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "websocket=1",
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Failed to create VNC proxy (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data?: { ticket?: string; port?: number } }
  const ticket = json.data?.ticket
  const port = json.data?.port
  if (!ticket) throw new Error("VNC ticket missing — is the VM powered on?")
  return {
    port: String(port),
    ticket,
    wsPath: `/api2/json/nodes/${node}/qemu/${vmid}/vncwebsocket`,
  }
}
