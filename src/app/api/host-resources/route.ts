/**
 * GET /api/host-resources
 *
 * Ludus host CPU and memory from Proxmox cluster resources (one pvesh call).
 * Any signed-in session may read it. The dashboard polls this; results are
 * reused for a few seconds so several browsers do not each open SSH.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/require-session"
import { sshExec } from "@/lib/proxmox-ssh"
import { requireProxmoxSsh } from "@/lib/root-ssh-auth"
import { parseClusterResourceNodes, type NodeResourceSample } from "@/lib/proxmox-node-metrics-parse"

export const maxDuration = 60

const CACHE_MS = 10_000

type HostResourcesBody = {
  capturedAt: number
  nodes: Array<{ name: string } & NodeResourceSample>
}

let cached: { at: number; body: HostResourcesBody } | null = null

export async function GET(req: NextRequest) {
  const gate = await requireSession(req)
  if (!gate.ok) return gate.response

  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) {
    return NextResponse.json(cached.body)
  }

  const ssh = requireProxmoxSsh()
  if (!ssh.ok) return NextResponse.json({ error: ssh.error }, { status: 503 })
  const { sshHost, sshPort, sshUser, sshPass } = ssh.creds

  try {
    const resourcesJson = await sshExec(
      sshHost,
      sshPort,
      sshUser,
      sshPass,
      ["pvesh", "get", "/cluster/resources", "--output-format", "json"],
    )
    const parsed = parseClusterResourceNodes(resourcesJson)
    const nodes = [...parsed.entries()]
      .map(([name, sample]) => ({ name, ...sample }))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (!nodes.length) {
      return NextResponse.json({ error: "No Proxmox nodes returned from pvesh" }, { status: 502 })
    }
    const body: HostResourcesBody = { capturedAt: now, nodes }
    cached = { at: now, body }
    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
