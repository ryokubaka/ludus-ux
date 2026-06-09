/**
 * GET /api/settings/proxmox-node-metrics
 *
 * Live Proxmox cluster node stats via pvesh over SSH (same auth as GOAD / admin VM).
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { isRootProxmoxSshConfigured } from "@/lib/root-ssh-auth"
import {
  parseClusterResourceNodes,
  parseNodeList,
  parseNodeStatusLoad,
} from "@/lib/proxmox-node-metrics-parse"

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const settings = getSettings()
  // Root `pvesh` over SSH — use only settings/env root password or mounted key.
  // Do not use `session.sshPassword` (LUX login password); it is not root@Proxmox
  // and would force password auth and skip the key, breaking key-only setups.
  if (!isRootProxmoxSshConfigured(settings)) {
    return NextResponse.json(
      {
        error:
          "No Proxmox root SSH auth in SSH & GOAD: set root SSH password or private key (path or mount).",
      },
      { status: 503 },
    )
  }

  const sshPass = (settings.proxmoxSshPassword || "").trim()
  const { sshHost, sshPort, proxmoxSshUser: sshUser } = settings

  try {
    const [nodeJson, resourcesJson] = await Promise.all([
      sshExec(sshHost, sshPort, sshUser, sshPass, "pvesh get /nodes --output-format json"),
      sshExec(
        sshHost,
        sshPort,
        sshUser,
        sshPass,
        "pvesh get /cluster/resources --type node --output-format json",
      ),
    ])
    const nodeNames = parseNodeList(nodeJson)
    if (!nodeNames.length) {
      return NextResponse.json({ error: "No Proxmox nodes returned from pvesh" }, { status: 502 })
    }

    const resourceByNode = parseClusterResourceNodes(resourcesJson)
    const capturedAt = Date.now()

    const results = await Promise.all(
      nodeNames.map(async (name) => {
        const fromResources = resourceByNode.get(name)
        try {
          const statusJson = await sshExec(
            sshHost,
            sshPort,
            sshUser,
            sshPass,
            `pvesh get /nodes/${name}/status --output-format json`,
          )
          const load1 = parseNodeStatusLoad(statusJson)
          return {
            name,
            cpuPct: fromResources?.cpuPct ?? null,
            memPct: fromResources?.memPct ?? null,
            load1,
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return {
            name,
            cpuPct: fromResources?.cpuPct ?? null,
            memPct: fromResources?.memPct ?? null,
            load1: null,
            error: msg,
          }
        }
      }),
    )

    return NextResponse.json({ capturedAt, nodes: results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
