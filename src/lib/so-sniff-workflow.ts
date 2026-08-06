/**
 * During Ludus DEPLOYING, attach SO sniff NIC + hub-mode as soon as the SO VM exists.
 * Idempotent; Proxmox is source of truth.
 */
import { ludusRequest } from "@/lib/ludus-client"
import { getProxyLudusTimeoutMs } from "@/lib/proxy-ludus-timeout"
import { requireProxmoxSsh } from "@/lib/root-ssh-auth"
import type { RangeObject, VMObject } from "@/lib/types"
import {
  cleanupSoSniffForRange,
  enableSoSniffOnVm,
  isSoVmName,
  rangeConfigNeedsSoSniff,
  SO_DEFAULT_SNIFF_TAG,
} from "@/lib/so-sniff"

const activeWatchers = new Map<string, { stop: boolean }>()

const WATCH_MAX_MS = 45 * 60 * 1000
const WATCH_INTERVAL_MS = 10_000

function vmList(range: RangeObject): VMObject[] {
  return range.VMs ?? range.vms ?? []
}

async function fetchRangeConfigYaml(apiKey: string, rangeId: string): Promise<string | null> {
  const res = await ludusRequest<{ result?: string }>(
    `/range/config?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey, timeout: getProxyLudusTimeoutMs("/range/config", "GET") },
  )
  if (res.error || !res.data?.result) return null
  return typeof res.data.result === "string" ? res.data.result : null
}

async function fetchRangeStatus(apiKey: string, rangeId: string): Promise<RangeObject | null> {
  const res = await ludusRequest<RangeObject>(
    `/range?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey, timeout: getProxyLudusTimeoutMs("/range", "GET") },
  )
  if (res.error || !res.data) return null
  return res.data
}

/**
 * Start a background poller for a range deploy. Safe to call multiple times (deduped).
 */
export function startSoSniffWatcher(args: {
  rangeId: string
  apiKey: string
  sniffTag?: number
}): void {
  const rangeId = args.rangeId?.trim()
  if (!rangeId || !args.apiKey?.trim()) return
  if (activeWatchers.has(rangeId)) {
    console.info(`[so-sniff] watcher already running for ${rangeId}`)
    return
  }

  const ssh = requireProxmoxSsh()
  if (!ssh.ok) {
    console.warn(`[so-sniff] watcher skip ${rangeId}: ${ssh.error}`)
    return
  }

  const handle = { stop: false }
  activeWatchers.set(rangeId, handle)

  void (async () => {
    const started = Date.now()
    let needsSo: boolean | null = null
    let enabledCount = 0

    console.info(`[so-sniff] watcher start range=${rangeId}`)
    try {
      while (!handle.stop && Date.now() - started < WATCH_MAX_MS) {
        if (needsSo === null) {
          const yaml = await fetchRangeConfigYaml(args.apiKey, rangeId)
          if (yaml != null) {
            needsSo = rangeConfigNeedsSoSniff(yaml)
            if (!needsSo) {
              console.info(`[so-sniff] watcher exit ${rangeId}: config has no SO`)
              break
            }
          }
        }

        const status = await fetchRangeStatus(args.apiKey, rangeId)
        if (!status) {
          await sleep(WATCH_INTERVAL_MS)
          continue
        }

        const vms = vmList(status)
        const soVms = vms.filter((v) => isSoVmName(v.name || v.vmName || "", rangeId))
        for (const vm of soVms) {
          const vmid = vm.proxmoxID || vm.ID
          if (!vmid) continue
          const result = await enableSoSniffOnVm({
            vmid,
            rangeNumber: status.rangeNumber ?? vm.rangeNumber,
            rangeId,
            vmName: vm.name || vm.vmName || `${rangeId}-so`,
            sniffTag: args.sniffTag ?? SO_DEFAULT_SNIFF_TAG,
            creds: ssh.creds,
          })
          if (result.ok) enabledCount += 1
        }

        const state = status.rangeState
        if (
          soVms.length > 0 &&
          enabledCount > 0 &&
          state !== "DEPLOYING" &&
          state !== "WAITING"
        ) {
          console.info(`[so-sniff] watcher done ${rangeId} state=${state}`)
          break
        }
        if (
          needsSo === true &&
          soVms.length === 0 &&
          state !== "DEPLOYING" &&
          state !== "WAITING" &&
          state !== "NEVER DEPLOYED"
        ) {
          console.info(`[so-sniff] watcher stop ${rangeId}: no SO VMs in ${state}`)
          break
        }

        await sleep(WATCH_INTERVAL_MS)
      }
    } catch (e) {
      console.warn(
        `[so-sniff] watcher error ${rangeId}: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      activeWatchers.delete(rangeId)
      console.info(`[so-sniff] watcher end range=${rangeId}`)
    }
  })()
}

export function stopSoSniffWatcher(rangeId: string): void {
  const h = activeWatchers.get(rangeId)
  if (h) h.stop = true
}

/** Cleanup sniff side effects; call before Ludus deleteRange while VMs may still exist. */
export async function cleanupSoSniffAfterRangeDelete(args: {
  rangeId: string
  rangeNumber?: number
  vmNames?: string[]
}): Promise<{ ok: boolean; detail: string }> {
  stopSoSniffWatcher(args.rangeId)
  return cleanupSoSniffForRange({
    rangeId: args.rangeId,
    rangeNumber: args.rangeNumber,
    vmNames: args.vmNames,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
