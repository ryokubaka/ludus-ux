import { NextRequest, NextResponse } from "next/server"
import { readProxmoxGuests } from "@/lib/proxmox/proxmox-template-guests-read"
import { requireSession } from "@/lib/session/require-session"

export const maxDuration = 60

/** Qemu guests on the Ludus host, so a Proxmox template can count as built. */
export async function GET(req: NextRequest) {
  const gate = await requireSession(req)
  if (!gate.ok) return gate.response
  try {
    const guests = await readProxmoxGuests()
    return NextResponse.json({ guests })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not list Proxmox guests"
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
