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

export const dynamic = "force-dynamic"
export const maxDuration = 60

const SAFE_NODE = /^[a-zA-Z0-9._-]+$/

function unwrapPveshJson(raw: string): unknown {
  const j = JSON.parse(raw) as unknown
  if (j && typeof j === "object" && "data" in j) {
    const d = (j as { data: unknown }).data
    return d
  }
  return j
}

function parseNodeList(raw: string): string[] {
  const j = unwrapPveshJson(raw)
  const arr = Array.isArray(j) ? j : []
  const names: string[] = []
  for (const row of arr) {
    if (!row || typeof row !== "object") continue
    const n = (row as { node?: string }).node
    if (typeof n === "string" && SAFE_NODE.test(n)) names.push(n)
  }
  return names
}

type MemBlock = { used?: number; total?: number }

function parseLoad1(loadavg: unknown): number | null {
  if (typeof loadavg === "string") {
    const first = loadavg.trim().split(/\s+/)[0]
    const v = parseFloat(first)
    return Number.isFinite(v) ? v : null
  }
  if (Array.isArray(loadavg) && loadavg.length > 0) {
    const v = parseFloat(String(loadavg[0]))
    return Number.isFinite(v) ? v : null
  }
  return null
}

function parseNodeStatusPayload(raw: string): {
  cpuPct: number | null
  memPct: number | null
  load1: number | null
} {
  let inner: unknown
  try {
    inner = unwrapPveshJson(raw)
  } catch {
    return { cpuPct: null, memPct: null, load1: null }
  }
  const o = inner && typeof inner === "object" ? (inner as Record<string, unknown>) : null
  if (!o) return { cpuPct: null, memPct: null, load1: null }

  let cpuPct: number | null = null
  const cpu = o.cpu
  if (typeof cpu === "number" && Number.isFinite(cpu)) {
    const ratio = cpu > 1 ? cpu / 100 : cpu
    cpuPct = Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10
  }

  let memPct: number | null = null
  const mem = o.memory
  if (mem && typeof mem === "object") {
    const m = mem as MemBlock
    const t = m.total
    const u = m.used
    if (typeof t === "number" && t > 0 && typeof u === "number") {
      memPct = Math.round(Math.min(1, Math.max(0, u / t)) * 1000) / 10
    }
  }

  const load1 = parseLoad1(o.loadavg)

  return { cpuPct, memPct, load1 }
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
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
    const nodeJson = await sshExec(
      sshHost,
      sshPort,
      sshUser,
      sshPass,
      "pvesh get /nodes --output-format json",
    )
    const nodeNames = parseNodeList(nodeJson)
    if (!nodeNames.length) {
      return NextResponse.json({ error: "No Proxmox nodes returned from pvesh" }, { status: 502 })
    }

    const capturedAt = Date.now()

    const results = await Promise.all(
      nodeNames.map(async (name) => {
        try {
          const statusJson = await sshExec(
            sshHost,
            sshPort,
            sshUser,
            sshPass,
            `pvesh get /nodes/${name}/status --output-format json`,
          )
          const { cpuPct, memPct, load1 } = parseNodeStatusPayload(statusJson)
          return { name, cpuPct, memPct, load1 }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return { name, cpuPct: null, memPct: null, load1: null, error: msg }
        }
      }),
    )

    return NextResponse.json({ capturedAt, nodes: results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
