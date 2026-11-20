/** A qemu guest from `pvesh get /cluster/resources --type vm`. */
export interface ProxmoxGuest {
  name: string
  vmid: number
  node: string
  /** Proxmox `template: 1`. Ludus can clone only these. */
  template: boolean
}

/** Ludus template names: letters, digits, dot, underscore, plus, hyphen. */
export function isTemplateName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(name)
}

function asRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: unknown[] }).data
  }
  return []
}

/** Names and vmids of qemu guests. A template wins when the same name appears twice. */
export function parseProxmoxGuests(payload: unknown): ProxmoxGuest[] {
  const byName = new Map<string, ProxmoxGuest>()
  for (const raw of asRows(payload)) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    if (row.type && row.type !== "qemu") continue
    const name = typeof row.name === "string" ? row.name.trim() : ""
    const vmid = typeof row.vmid === "number" ? row.vmid : Number(row.vmid)
    if (!name || !Number.isInteger(vmid) || vmid <= 0) continue
    const template = row.template === 1 || row.template === "1" || row.template === true
    const guest: ProxmoxGuest = {
      name,
      vmid,
      node: typeof row.node === "string" ? row.node : "",
      template,
    }
    const prev = byName.get(name)
    if (!prev || (template && !prev.template)) byName.set(name, guest)
  }
  return [...byName.values()]
}

export function proxmoxGuestForName(guests: ProxmoxGuest[], name: string): ProxmoxGuest | null {
  return guests.find((guest) => guest.name === name) ?? null
}

export function markTemplatesFromProxmox<T extends { name: string; built: boolean }>(
  templates: T[],
  guests: ProxmoxGuest[],
): Array<T & { proxmox?: "template" | "vm" }> {
  return templates.map((template) => {
    const guest = proxmoxGuestForName(guests, template.name)
    if (!guest) return template
    if (guest.template) return { ...template, built: true, proxmox: "template" as const }
    return { ...template, proxmox: "vm" as const }
  })
}
