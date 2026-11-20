import { NextRequest, NextResponse } from "next/server"
import {
  isTemplateName,
  proxmoxGuestForName,
} from "@/lib/proxmox/proxmox-template-guests"
import { readProxmoxGuests } from "@/lib/proxmox/proxmox-template-guests-read"
import { requireSession } from "@/lib/session/require-session"
import { requireProxmoxSsh } from "@/lib/ssh/root-ssh-auth"
import { sshExec } from "@/lib/ssh/proxmox-ssh"

export const maxDuration = 120

/**
 * Power off a same-named Proxmox VM and convert it to a template.
 * Ludus clones only guests with template: 1, so a finished Packer VM that was
 * never converted still shows as added.
 */
export async function POST(req: NextRequest) {
  const gate = await requireSession(req)
  if (!gate.ok) return gate.response
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!isTemplateName(name)) {
    return NextResponse.json({ error: "Template name is not valid" }, { status: 400 })
  }

  let guests
  try {
    guests = await readProxmoxGuests()
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not list Proxmox guests"
    return NextResponse.json({ error: message }, { status: 503 })
  }
  const guest = proxmoxGuestForName(guests, name)
  if (!guest) {
    return NextResponse.json({ error: `No Proxmox guest is named ${name}` }, { status: 404 })
  }
  if (guest.template) return NextResponse.json({ ok: true, already: true })

  const ssh = requireProxmoxSsh()
  if (!ssh.ok) return NextResponse.json({ error: ssh.error }, { status: 503 })
  try {
    await sshExec(
      ssh.creds.sshHost,
      ssh.creds.sshPort,
      ssh.creds.sshUser,
      ssh.creds.sshPass,
      ["qm-template", String(guest.vmid), name],
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not convert the VM to a template"
    return NextResponse.json({ error: message }, { status: 502 })
  }
  return NextResponse.json({ ok: true, already: false, vmid: guest.vmid })
}
