import { vmIsRunning } from "@/lib/dashboard-vm-merge"
import type { VMObject } from "@/lib/types"

export type PowerAction = "on" | "off"

export function vmDisplayName(vm: VMObject): string {
  return vm.name || vm.vmName || `vm-${vm.ID}`
}

export function extractVmsFromRangePayload(
  data: { VMs?: VMObject[]; vms?: VMObject[] } | null | undefined,
): VMObject[] {
  if (!data) return []
  return data.VMs || data.vms || []
}

export function vmMatchesExpectedPower(vm: VMObject, action: PowerAction): boolean {
  const running = vmIsRunning(vm)
  return action === "on" ? running : !running
}

/** Which target VM names have not yet reached the expected power state. */
export function pendingVmPowerNames(
  vms: VMObject[],
  targetNames: string[],
  action: PowerAction,
): string[] {
  const pending: string[] = []
  for (const name of targetNames) {
    const vm = vms.find((v) => vmDisplayName(v) === name)
    if (!vm || !vmMatchesExpectedPower(vm, action)) pending.push(name)
  }
  return pending
}

export type VmPowerWaitResult =
  | { ok: true; confirmed: string[] }
  | { ok: false; via: "timeout"; pending: string[] }
  | { ok: false; via: "missing_range"; detail: string }

export async function waitForVmPowerConfirmation(opts: {
  rangeId?: string
  vmNames: string[]
  action: PowerAction
  fetchStatus: () => Promise<{
    data?: { VMs?: VMObject[]; vms?: VMObject[] } | null
    error?: string
  }>
  pollMs?: number
  timeoutMs?: number
}): Promise<VmPowerWaitResult> {
  const pollMs = opts.pollMs ?? 2_000
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000
  const targetNames = opts.vmNames.filter(Boolean)
  if (targetNames.length === 0) {
    return { ok: true, confirmed: [] }
  }
  if (!opts.rangeId?.trim()) {
    return { ok: false, via: "missing_range", detail: "rangeId required to confirm VM power state" }
  }

  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await opts.fetchStatus()
    const vms = extractVmsFromRangePayload(res.data ?? undefined)
    const pending = pendingVmPowerNames(vms, targetNames, opts.action)
    if (pending.length === 0) {
      return { ok: true, confirmed: targetNames }
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }

  const res = await opts.fetchStatus()
  const vms = extractVmsFromRangePayload(res.data ?? undefined)
  const pending = pendingVmPowerNames(vms, targetNames, opts.action)
  if (pending.length === 0) {
    return { ok: true, confirmed: targetNames }
  }
  return { ok: false, via: "timeout", pending }
}
