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
