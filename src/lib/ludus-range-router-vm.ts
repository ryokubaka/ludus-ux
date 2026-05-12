import type { VMObject } from "./types"

/**
 * Ludus adds a per-range Debian VM for outbound firewall / testing rules
 * (`…-router-debian11-x64`, etc.). Testing start/stop skips it server-side;
 * snapshot create/revert/delete should omit it so router state is not touched.
 */
export function isLudusRangeRouterVmName(vmName: string | undefined | null): boolean {
  if (!vmName || typeof vmName !== "string") return false
  const n = vmName.trim().toLowerCase()
  return n.includes("-router-debian") || n.includes("_router_debian")
}

/** First VM that matches Ludus range-router naming (`…-router-debian…`). */
export function findLudusRangeRouterVm(vms: VMObject[] | undefined | null): VMObject | null {
  if (!vms?.length) return null
  for (const vm of vms) {
    const label = vm.name || vm.vmName || ""
    if (isLudusRangeRouterVmName(label)) return vm
  }
  return null
}

/** Matches dashboard / VM table semantics for “running”. */
export function isLudusVmRunning(vm: VMObject): boolean {
  return vm.poweredOn === true || vm.powerState === "running"
}

function proxmoxIdForVm(vm: VMObject): number | null {
  const raw = vm.proxmoxID ?? vm.ID
  const id = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(id) ? id : null
}

/** Proxmox VMIDs for snapshot APIs, excluding the range infrastructure router. */
export function snapshotTargetProxmoxIdsExcludingRouter(vms: VMObject[] | undefined | null): number[] {
  if (!vms?.length) return []
  const out: number[] = []
  for (const vm of vms) {
    const label = vm.name || vm.vmName || ""
    if (isLudusRangeRouterVmName(label)) continue
    const id = proxmoxIdForVm(vm)
    if (id != null) out.push(id)
  }
  return out
}
