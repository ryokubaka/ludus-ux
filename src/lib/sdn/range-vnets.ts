/**
 * Range SDN vnets are named r{rangeNumber} in the Ludus zone.
 * The name is only a number. The range ID lives in the vnet alias.
 */

export const RANGE_SDN_ZONE = "ludus"

export type RangeVnetRecord = {
  vnet: string
  zone: string
  alias: string | null
  tag: number | null
}

export type LiveRangeRef = {
  rangeID: string
  rangeNumber: number
}

export type TiedVnet = {
  vnet: string
  rangeID: string
  rangeNumber: number
  zone: string
  currentAlias: string | null
  aliasMatches: boolean
  tagMatches: boolean
}

export type OrphanVnet = {
  vnet: string
  zone: string
  alias: string | null
  tag: number | null
}

export type UnresolvedVnet = {
  vnet: string
  rangeNumber: number
  rangeIDs: string[]
}

export type UnmanagedVnet = {
  vnet: string
  zone: string
  alias: string | null
}

export type RangeVnetPlan = {
  zone: string
  tied: TiedVnet[]
  orphans: OrphanVnet[]
  unresolved: UnresolvedVnet[]
  unmanaged: UnmanagedVnet[]
}

const RANGE_VNET_NAME = /^r([1-9][0-9]{0,3})$/
const CLASSIC_RANGE_BRIDGE = /^vmbr([1-9][0-9]*)$/

export function isRangeVnetName(name: string): boolean {
  return RANGE_VNET_NAME.test(name)
}

export function rangeVnetName(rangeNumber: number): string | null {
  if (!Number.isInteger(rangeNumber) || rangeNumber < 1 || rangeNumber > 9999) return null
  return `r${rangeNumber}`
}

/** Standalone Ludus bridge: vmbr1000 plus the range number. vmbr1000 itself is the NAT bridge. */
export function classicRangeBridgeName(rangeNumber: number): string | null {
  if (!rangeVnetName(rangeNumber)) return null
  return `vmbr${1000 + rangeNumber}`
}

export function isClassicRangeBridgeName(name: string): boolean {
  const match = CLASSIC_RANGE_BRIDGE.exec(name)
  if (!match) return false
  const number = Number(match[1]) - 1000
  return classicRangeBridgeName(number) === name
}

/** Cluster vnet or standalone vmbr. lux-host bridge-ageing accepts both shapes. */
export function isRangeBridgeName(name: string): boolean {
  return isRangeVnetName(name) || isClassicRangeBridgeName(name)
}

/**
 * Both names a Security Onion range can be plugged into.
 * Cluster mode creates rN. A single node creates vmbr10XX.
 * A host that left cluster mode can still have VMs on rN, so hub mode checks both
 * and only touches a bridge that exists.
 */
export function rangeHubBridges(rangeNumber: number): string[] {
  const names = [rangeVnetName(rangeNumber), classicRangeBridgeName(rangeNumber)]
  return names.filter((name): name is string => name != null)
}

/** Bridges whose ageing file was readable and is not already hub mode. */
export function bridgesNeedingHub(ageing: Record<string, number>): string[] {
  return Object.entries(ageing)
    .filter(([name, value]) => isRangeBridgeName(name) && value !== 0)
    .map(([name]) => name)
}

/** Proxmox vnet alias: one range ID, no spaces or shell metacharacters. */
export function isSafeRangeAlias(rangeID: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rangeID)
}

export function rangeConfigNeedsHubMode(configText: string): boolean {
  return /ludus_securityonion\b|securityonion-\d/i.test(configText)
}

export function planRangeVnets(
  ranges: LiveRangeRef[],
  vnets: RangeVnetRecord[],
  zone = RANGE_SDN_ZONE,
): RangeVnetPlan {
  const byNumber = new Map<number, LiveRangeRef[]>()
  for (const range of ranges) {
    if (!range.rangeID.trim() || !rangeVnetName(range.rangeNumber)) continue
    const list = byNumber.get(range.rangeNumber) ?? []
    list.push(range)
    byNumber.set(range.rangeNumber, list)
  }

  const tied: TiedVnet[] = []
  const orphans: OrphanVnet[] = []
  const unresolved: UnresolvedVnet[] = []
  const unmanaged: UnmanagedVnet[] = []

  for (const vnet of vnets) {
    if (vnet.zone !== zone || !isRangeVnetName(vnet.vnet)) {
      unmanaged.push({ vnet: vnet.vnet, zone: vnet.zone, alias: vnet.alias })
      continue
    }
    const number = Number(RANGE_VNET_NAME.exec(vnet.vnet)?.[1])
    const owners = byNumber.get(number) ?? []
    if (owners.length === 0) {
      orphans.push({ vnet: vnet.vnet, zone: vnet.zone, alias: vnet.alias, tag: vnet.tag })
      continue
    }
    if (owners.length > 1) {
      unresolved.push({
        vnet: vnet.vnet,
        rangeNumber: number,
        rangeIDs: owners.map((owner) => owner.rangeID),
      })
      continue
    }
    const owner = owners[0]
    tied.push({
      vnet: vnet.vnet,
      rangeID: owner.rangeID,
      rangeNumber: number,
      zone: vnet.zone,
      currentAlias: vnet.alias,
      aliasMatches: vnet.alias === owner.rangeID,
      tagMatches: vnet.tag === number,
    })
  }

  return { zone, tied, orphans, unresolved, unmanaged }
}

export function aliasUpdates(plan: RangeVnetPlan): Array<{ vnet: string; rangeID: string }> {
  return plan.tied
    .filter((row) => !row.aliasMatches && isSafeRangeAlias(row.rangeID))
    .map((row) => ({ vnet: row.vnet, rangeID: row.rangeID }))
}

export function parseSdnVnetPayload(payload: unknown): RangeVnetRecord[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : []
  const out: RangeVnetRecord[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const rec = row as Record<string, unknown>
    const vnet = typeof rec.vnet === "string" ? rec.vnet : ""
    const zone = typeof rec.zone === "string" ? rec.zone : ""
    if (!vnet || !zone) continue
    const alias = typeof rec.alias === "string" && rec.alias.trim() ? rec.alias.trim() : null
    const tagRaw = rec.tag
    const tag =
      typeof tagRaw === "number" && Number.isInteger(tagRaw)
        ? tagRaw
        : typeof tagRaw === "string" && /^\d+$/.test(tagRaw)
          ? Number(tagRaw)
          : null
    out.push({ vnet, zone, alias, tag })
  }
  return out
}

/**
 * LUX in Docker cannot use a Proxmox URL that points at the container's
 * own loopback. The SSH host is the node LUX already reaches.
 */
export function proxmoxApiBase(proxmoxUrl: string, sshHost: string): string {
  const raw = proxmoxUrl.trim()
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const url = new URL(withScheme)
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") {
    const host = sshHost.trim()
    if (host) url.hostname = host
  }
  if (!url.port) url.port = "8006"
  const path = url.pathname.replace(/\/$/, "")
  url.pathname = path.endsWith("/api2/json") ? path : "/api2/json"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

export function guestPortProbeCommand(vnets: string[]): string {
  const names = vnets.map((vnet) => {
    if (!isRangeBridgeName(vnet)) throw new Error("range bridge name")
    return vnet
  })
  if (names.length === 0) return "true"
  return names
    .map(
      (vnet) =>
        `if [ -d /sys/class/net/${vnet}/brif ]; then for p in /sys/class/net/${vnet}/brif/*; do [ -e "$p" ] || continue; n=$(basename "$p"); case "$n" in tap*|fwpr*|veth*) printf '%s %s\\n' ${vnet} "$n";; esac; done; fi`,
    )
    .join("\n")
}

export function parseGuestPortProbe(stdout: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const line of stdout.split("\n")) {
    const [vnet, port] = line.trim().split(/\s+/)
    if (!vnet || !port || !isRangeBridgeName(vnet)) continue
    if (!/^(tap|fwpr|veth)/.test(port)) continue
    const list = out[vnet] ?? []
    list.push(port)
    out[vnet] = list
  }
  return out
}

export function ageingProbeCommand(vnets: string[]): string {
  const names = vnets.map((vnet) => {
    if (!isRangeBridgeName(vnet)) throw new Error("range bridge name")
    return vnet
  })
  if (names.length === 0) return "true"
  return names
    .map(
      (vnet) =>
        `if [ -f /sys/class/net/${vnet}/bridge/ageing_time ]; then printf '%s %s\\n' ${vnet} "$(cat /sys/class/net/${vnet}/bridge/ageing_time)"; fi`,
    )
    .join("\n")
}

/** Set hub mode on one range bridge. The name is already checked, so the shell sees no other interface. */
export function hubAgeingWriteCommand(bridge: string): string {
  if (!isRangeBridgeName(bridge)) throw new Error("range bridge name")
  return [
    `f=/sys/class/net/${bridge}/bridge/ageing_time`,
    'test -e "$f" || exit 2',
    "printf '0\\n' > \"$f\" || exit 1",
    'test "$(cat "$f")" = 0',
  ].join("; ")
}

export function parseAgeingProbe(stdout: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of stdout.split("\n")) {
    const [vnet, raw] = line.trim().split(/\s+/)
    if (!vnet || !isRangeBridgeName(vnet) || !/^\d+$/.test(raw ?? "")) continue
    out[vnet] = Number(raw)
  }
  return out
}

/** A network reload is safe only when no range vnet still has a guest interface. */
export function sdnApplyIsSafe(guestPortsByVnet: Record<string, string[]>): boolean {
  return Object.values(guestPortsByVnet).every((ports) => ports.length === 0)
}
