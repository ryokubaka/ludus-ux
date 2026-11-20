import "server-only"

import { parseProxmoxGuests, type ProxmoxGuest } from "@/lib/proxmox/proxmox-template-guests"
import { requireProxmoxSsh } from "@/lib/ssh/root-ssh-auth"
import { sshExec } from "@/lib/ssh/proxmox-ssh"

export async function readProxmoxGuests(): Promise<ProxmoxGuest[]> {
  const ssh = requireProxmoxSsh()
  if (!ssh.ok) throw new Error(ssh.error)
  const stdout = await sshExec(
    ssh.creds.sshHost,
    ssh.creds.sshPort,
    ssh.creds.sshUser,
    ssh.creds.sshPass,
    ["pvesh", "get", "/cluster/resources", "--type", "vm", "--output-format", "json"],
  )
  return parseProxmoxGuests(JSON.parse(stdout) as unknown)
}
