import { ludusApi } from "@/lib/api"

export type ClearRangeVmsResult =
  | { ok: true; hadVms: boolean }
  | { ok: false; error: string }

/**
 * Delete all VMs in a range and poll until Ludus reports none remain.
 * Matches the range wizard deploy path — GOAD/Ludus ansible inventory must not
 * run while Proxmox VMs are still being destroyed.
 */
export async function clearRangeVmsAndWait(
  rangeId: string,
  options?: {
    maxWaitMs?: number
    pollMs?: number
    onRemaining?: (count: number) => void
  },
): Promise<ClearRangeVmsResult> {
  const rid = rangeId.trim()
  if (!rid) return { ok: false, error: "rangeId is required" }

  const maxWait = options?.maxWaitMs ?? 90_000
  const pollMs = options?.pollMs ?? 4_000

  const pre = await ludusApi.getRangeStatus(rid)
  const initial = pre.data?.VMs?.length ?? 0
  if (initial === 0) return { ok: true, hadVms: false }

  const delRes = await ludusApi.deleteRangeVMs(rid)
  if (delRes.error) {
    return { ok: false, error: delRes.error }
  }

  const start = Date.now()
  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, pollMs))
    const check = await ludusApi.getRangeStatus(rid)
    const remaining = check.data?.VMs?.length ?? 0
    options?.onRemaining?.(remaining)
    if (remaining === 0) return { ok: true, hadVms: true }
  }

  return {
    ok: false,
    error: `Timed out after ${Math.round(maxWait / 1000)}s waiting for VMs to be destroyed`,
  }
}
