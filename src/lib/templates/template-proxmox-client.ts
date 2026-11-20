import type { ProxmoxGuest } from "@/lib/proxmox/proxmox-template-guests"
import { markTemplatesFromProxmox } from "@/lib/proxmox/proxmox-template-guests"

export async function fetchProxmoxGuests(): Promise<ProxmoxGuest[]> {
  const res = await fetch("/api/templates/proxmox-guests")
  const body = (await res.json().catch(() => ({}))) as { guests?: ProxmoxGuest[]; error?: string }
  if (!res.ok) throw new Error(body.error || "Could not list Proxmox guests")
  return body.guests ?? []
}

export async function convertVmToTemplate(name: string): Promise<void> {
  const res = await fetch("/api/templates/convert-to-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error || "Could not convert the VM to a template")
}

export { markTemplatesFromProxmox }
