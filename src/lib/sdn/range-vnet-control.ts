import "server-only"

import { sshExec, sshExecAccount } from "@/lib/goad/goad-ssh"
import { extractLudusList } from "@/lib/core/utils"
import type { RangeObject } from "@/lib/core/types"
import { ludusRequest } from "@/lib/ludus/ludus-client"
import { readLudusProxmoxDeployEnv } from "@/lib/ludus/ludus-proxmox-deploy-env"
import { getSettings } from "@/lib/settings/settings-store"
import { ludusFetch } from "@/lib/ludus/ludus-fetch"
import {
  ageingProbeCommand,
  bridgesNeedingHub,
  guestPortProbeCommand,
  hubAgeingWriteCommand,
  isRangeVnetName,
  parseAgeingProbe,
  parseGuestPortProbe,
  parseSdnVnetPayload,
  proxmoxApiBase,
  rangeConfigNeedsHubMode,
  rangeHubBridges,
  rangeVnetName,
  sdnApplyIsSafe,
  type RangeVnetPlan,
  type RangeVnetRecord,
} from "@/lib/sdn/range-vnets"

const DEFAULT_INTERVAL_MS = 60_000
const MIN_INTERVAL_MS = 15_000

type RangeVnetGlobal = typeof globalThis & {
  __luxRangeVnetStarted?: boolean
  __luxRangeVnetTimer?: ReturnType<typeof setInterval>
  __luxRangeVnetNoKeyWarned?: boolean
  __luxRangeVnetRootKeyWarned?: boolean
}

/** Ludus accepts a `ROOT.` key only for user actions, not for `/range/all`. */
export function isLudusRootApiKey(apiKey: string): boolean {
  return apiKey.trim().startsWith("ROOT.")
}

const configCache = new Map<string, string>()

export function rangeVnetIntervalMs(): number {
  const raw = process.env.LUX_RANGE_VNET_INTERVAL_MS
  if (raw == null || raw.trim() === "") return DEFAULT_INTERVAL_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(MIN_INTERVAL_MS, Math.floor(n))
}

type ProxmoxAuth = { base: string; authorization: string }

async function proxmoxAuth(): Promise<ProxmoxAuth | null> {
  const env = await readLudusProxmoxDeployEnv()
  if (!env) return null
  const settings = getSettings()
  return {
    base: proxmoxApiBase(env.PROXMOX_URL, settings.sshHost || env.PROXMOX_HOSTNAME),
    authorization: `PVEAPIToken=${env.PROXMOX_TOKEN}=${env.PROXMOX_SECRET}`,
  }
}

async function pve(
  auth: ProxmoxAuth,
  path: string,
  init?: { method?: string; body?: string },
): Promise<unknown> {
  const res = await ludusFetch(`${auth.base}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: auth.authorization,
      ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init?.body,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Proxmox ${init?.method ?? "GET"} ${path} failed (HTTP ${res.status}): ${text.slice(0, 180)}`)
  }
  if (!text.trim()) return null
  return JSON.parse(text) as unknown
}

export async function listRangeVnets(): Promise<RangeVnetRecord[]> {
  const auth = await proxmoxAuth()
  if (!auth) throw new Error("Proxmox token is not available")
  return parseSdnVnetPayload(await pve(auth, "/cluster/sdn/vnets"))
}

async function listRanges(apiKey: string): Promise<RangeObject[]> {
  // `/range/all` is a port 8080 call. Port 8081 rejects it, and the ROOT key is rejected on both.
  const result = await ludusRequest("/range/all", { apiKey, useAdminEndpoint: false })
  if (result.error) throw new Error(result.error)
  return extractLudusList<RangeObject>(result.data)
}

async function guestPorts(vnets: string[]): Promise<Record<string, string[]>> {
  if (vnets.length === 0) return {}
  const result = await sshExecAccount(guestPortProbeCommand(vnets))
  if (result.code !== 0) {
    throw new Error(result.stderr.trim().slice(0, 200) || "failed to read vnet ports")
  }
  return parseGuestPortProbe(result.stdout)
}

export type OrphanRemoval = {
  removed: string[]
  skipped: Array<{ vnet: string; reason: string }>
  reload: "applied" | "deferred" | "not-needed"
}

/**
 * Drop vnets whose range number no longer exists.
 * A vnet with a guest tap stays. The network reload stays deferred while any
 * remaining range vnet still has a guest tap, so a live range is not bounced.
 */
export async function removeOrphanVnets(plan: RangeVnetPlan): Promise<OrphanRemoval> {
  if (plan.orphans.length === 0) return { removed: [], skipped: [], reload: "not-needed" }
  const auth = await proxmoxAuth()
  if (!auth) throw new Error("Proxmox token is not available")
  const names = plan.orphans.map((row) => row.vnet)
  const ports = await guestPorts(names)
  const removed: string[] = []
  const skipped: Array<{ vnet: string; reason: string }> = []
  for (const orphan of plan.orphans) {
    const attached = ports[orphan.vnet] ?? []
    if (attached.length > 0) {
      skipped.push({ vnet: orphan.vnet, reason: `guest interfaces: ${attached.join(", ")}` })
      continue
    }
    const res = await ludusFetch(`${auth.base}/cluster/sdn/vnets/${orphan.vnet}`, {
      method: "DELETE",
      headers: { Authorization: auth.authorization },
    })
    if (res.status === 404) {
      skipped.push({ vnet: orphan.vnet, reason: "no SDN vnet" })
      continue
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Proxmox DELETE ${orphan.vnet} failed (HTTP ${res.status}): ${text.slice(0, 180)}`)
    }
    removed.push(orphan.vnet)
  }
  if (removed.length === 0) return { removed, skipped, reload: "not-needed" }

  const remaining = (await listRangeVnets()).filter((row) => isRangeVnetName(row.vnet))
  const remainingPorts = await guestPorts(remaining.map((row) => row.vnet))
  if (!sdnApplyIsSafe(remainingPorts)) {
    return { removed, skipped, reload: "deferred" }
  }
  await pve(auth, "/cluster/sdn", { method: "PUT" })
  return { removed, skipped, reload: "applied" }
}

async function rangeConfigText(rangeID: string, apiKey: string, cacheKey: string): Promise<string> {
  const hit = configCache.get(cacheKey)
  if (hit != null) return hit
  const result = await ludusRequest<{ result?: string }>(
    `/range/config?rangeID=${encodeURIComponent(rangeID)}`,
    { apiKey },
  )
  const text = typeof result.data?.result === "string" ? result.data.result : ""
  configCache.set(cacheKey, text)
  return text
}

/**
 * Re-apply hub mode after a range power-on.
 * Cluster ranges use rN. Standalone ranges use vmbr10XX. A bridge that is
 * not present is left alone, so either layout works on the same LUX build.
 */
export async function ensureHubModeForPowerOn(rangeID: string, apiKey: string): Promise<void> {
  if (!rangeID || !apiKey) return
  const range = await ludusRequest<RangeObject>(
    `/range?rangeID=${encodeURIComponent(rangeID)}`,
    { apiKey },
  )
  const bridges = rangeHubBridges(range.data?.rangeNumber ?? NaN)
  if (bridges.length === 0) return
  const config = await ludusRequest<{ result?: string }>(
    `/range/config?rangeID=${encodeURIComponent(rangeID)}`,
    { apiKey },
  )
  const text = typeof config.data?.result === "string" ? config.data.result : ""
  if (!rangeConfigNeedsHubMode(text)) return
  await reapplyHub(bridges)
}

async function reapplyHub(bridges: string[]): Promise<void> {
  if (bridges.length === 0) return
  const probe = await sshExecAccount(ageingProbeCommand(bridges))
  if (probe.code !== 0) {
    throw new Error(probe.stderr.trim().slice(0, 200) || "failed to read bridge ageing")
  }
  for (const bridge of bridgesNeedingHub(parseAgeingProbe(probe.stdout))) {
    const viaHelper = await sshExec(["bridge-ageing", bridge]).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      return { stdout: "", stderr: message, code: 1 }
    })
    if (viaHelper.code === 0) continue
    // Root password and a root key can write this one file without lux-host.
    const direct = await sshExecAccount(hubAgeingWriteCommand(bridge))
    if (direct.code !== 0) {
      const detail = direct.stderr.trim() || viaHelper.stderr.trim()
      throw new Error(detail.slice(0, 200) || `bridge-ageing ${bridge} failed`)
    }
  }
}

/**
 * After the range record is gone, drop its vnet when no guest is still attached.
 * The caller must pass the number captured before the delete.
 */
export async function releaseRangeVnet(rangeNumber: number): Promise<void> {
  const vnet = rangeVnetName(rangeNumber)
  if (!vnet) return
  const plan: RangeVnetPlan = {
    zone: "ludus",
    tied: [],
    orphans: [{ vnet, zone: "ludus", alias: null, tag: rangeNumber }],
    unresolved: [],
    unmanaged: [],
  }
  const outcome = await removeOrphanVnets(plan)
  console.info(
    `[range-vnet] release ${vnet} removed=${outcome.removed.join(",") || "none"} reload=${outcome.reload}`,
  )
}

export async function lookupRangeNumber(rangeID: string, apiKey: string): Promise<number | null> {
  const range = await ludusRequest<RangeObject>(
    `/range?rangeID=${encodeURIComponent(rangeID)}`,
    { apiKey },
  )
  const number = range.data?.rangeNumber
  return typeof number === "number" && Number.isInteger(number) ? number : null
}

async function reapplyHubForPoweredRanges(ranges: RangeObject[], apiKey: string): Promise<void> {
  const wanted: string[] = []
  for (const range of ranges) {
    const bridges = rangeHubBridges(range.rangeNumber)
    if (bridges.length === 0) continue
    const vms = range.VMs ?? range.vms ?? []
    if (!vms.some((vm) => vm.poweredOn)) continue
    const text = await rangeConfigText(
      range.rangeID,
      apiKey,
      `${range.rangeID}\0${range.lastDeployment ?? ""}`,
    )
    if (rangeConfigNeedsHubMode(text)) wanted.push(...bridges)
  }
  if (wanted.length === 0) return
  try {
    await reapplyHub(wanted)
  } catch (err) {
    console.error("[range-vnet] hub:", err instanceof Error ? err.message : String(err))
  }
}

/**
 * Restore hub mode for a powered-on Security Onion range.
 * Alias updates and orphan removal stay on the admin action, so a
 * running LUX does not rewrite SDN config on its own.
 */
export async function runRangeVnetPass(): Promise<void> {
  const apiKey = getSettings().rootApiKey.trim()
  const g = globalThis as RangeVnetGlobal
  if (!apiKey) {
    if (!g.__luxRangeVnetNoKeyWarned) {
      g.__luxRangeVnetNoKeyWarned = true
      console.info("[range-vnet] skipped; root API key is not set")
    }
    return
  }
  if (isLudusRootApiKey(apiKey)) {
    if (!g.__luxRangeVnetRootKeyWarned) {
      g.__luxRangeVnetRootKeyWarned = true
      console.info("[range-vnet] skipped; the ROOT API key cannot list ranges. Hub mode still runs when that range is powered on.")
    }
    return
  }
  const ranges = await listRanges(apiKey)
  await reapplyHubForPoweredRanges(ranges, apiKey)
}

export function startRangeVnetLoop(): void {
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build") return
  const intervalMs = rangeVnetIntervalMs()
  if (intervalMs === 0) return
  const g = globalThis as RangeVnetGlobal
  if (g.__luxRangeVnetStarted) return
  g.__luxRangeVnetStarted = true
  console.log(`[range-vnet] enabled interval=${Math.round(intervalMs / 1000)}s`)
  const tick = () => {
    void runRangeVnetPass().catch((err) => {
      console.error("[range-vnet]", err instanceof Error ? err.message : String(err))
    })
  }
  setTimeout(tick, 20_000)
  g.__luxRangeVnetTimer = setInterval(tick, intervalMs)
  g.__luxRangeVnetTimer.unref?.()
}
