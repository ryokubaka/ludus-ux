/**
 * Direct HTTP calls to the Proxmox VE API.
 *
 * Used for in-browser VNC — authenticates with a PAM password.
 * SSH key auth is not used here; SPICE / pvesh paths use SSH separately.
 *
 * TLS: Node verifies certs by default. Set LUDUS_TLS_INSECURE=true (lab only) to allow
 * Proxmox self-signed certificates, or use NODE_EXTRA_CA_CERTS with your CA bundle.
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

export async function proxmoxGetNodeForVmid(
  host: string,
  auth: ProxmoxAuth,
  vmid: string,
): Promise<string> {
  const res = await fetch(`https://${host}:8006/api2/json/cluster/resources?type=vm`, {
    headers: {
      Cookie: `PVEAuthCookie=${auth.cookie}`,
      CSRFPreventionToken: auth.csrf,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Failed to find Proxmox node for VM ${vmid} (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    data?: Array<{ vmid?: number | string; node?: string; type?: string }>
  }
  const vm = json.data?.find((item) => String(item.vmid) === vmid && (!item.type || item.type === "qemu"))
  if (!vm?.node) {
    throw new Error(`VM ${vmid} was not found in Proxmox cluster resources, or this user cannot access it.`)
  }
  return vm.node
}

export interface VncProxyInfo {
  port: string
  ticket: string
  wsPath: string
  password?: string
}

export interface SpiceProxyInfo {
  password?: string
  host?: string
  proxy?: string
}

export async function proxmoxCreateSpiceProxy(
  host: string,
  auth: ProxmoxAuth,
  node: string,
  vmid: string,
): Promise<SpiceProxyInfo> {
  const res = await fetch(
    `https://${host}:8006/api2/json/nodes/${node}/qemu/${vmid}/spiceproxy`,
    {
      method: "POST",
      headers: {
        Cookie: `PVEAuthCookie=${auth.cookie}`,
        CSRFPreventionToken: auth.csrf,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `proxy=${host}`,
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Failed to create SPICE proxy (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data?: SpiceProxyInfo }
  return json.data ?? {}
}

export async function proxmoxCreateVncProxy(
  host: string,
  auth: ProxmoxAuth,
  node: string,
  vmid: string,
  options?: { websocket?: boolean },
): Promise<VncProxyInfo> {
  const websocket = options?.websocket !== false
  const res = await fetch(
    `https://${host}:8006/api2/json/nodes/${node}/qemu/${vmid}/vncproxy`,
    {
      method: "POST",
      headers: {
        Cookie: `PVEAuthCookie=${auth.cookie}`,
        CSRFPreventionToken: auth.csrf,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: websocket ? "websocket=1" : "",
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Failed to create VNC proxy (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data?: { ticket?: string; port?: number | string; password?: string } }
  const ticket = json.data?.ticket
  const port = json.data?.port
  if (!ticket) throw new Error("VNC ticket missing — is the VM powered on?")
  return {
    port: String(port),
    ticket,
    password: json.data?.password,
    wsPath: `/api2/json/nodes/${node}/qemu/${vmid}/vncwebsocket`,
  }
}
