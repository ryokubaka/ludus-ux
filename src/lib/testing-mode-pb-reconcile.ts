/**
 * Testing-mode op completion for LUX `/api/range/ops`.
 *
 * Design:
 * - **Ansible log since op start** is the primary completion signal (Ludus/PB often lag).
 * - **PocketBase patch with retries** after ansible proves done — awaited before op success.
 * - **No passive pb-status reconcile** — status reads must not PATCH PB (avoids fighting in-flight ops).
 */

import { ludusRequest } from "@/lib/ludus-client"
import {
  parseAnsibleRecapAllOk,
  readLudusAnsibleLogByteLength,
  readLudusAnsibleLogSuffixFromByteOffset,
  readLudusRangeLogsForReconcile,
} from "@/lib/goad-ludus-reconcile"
import { fetchPbRangeStatus, setPbTestingEnabled } from "@/lib/pocketbase-client"
import type { RangeOpType, RangeOpLogMarker } from "@/lib/range-op-store"
import { loadRangeOpLogMarker, saveRangeOpLogMarker } from "@/lib/range-op-store"
import { splitLeadingWallTimestamp } from "@/lib/log-line-timestamp"

/** Ignore ansible tail for a few seconds — Ludus may not have appended output yet. */
export const TESTING_OP_MIN_AGE_MS = 10_000

const TAIL_ANCHOR_CHARS = 8192
/** SSH suffix read for testing-op completion — must include full snapshot+block+recap runs. */
const TESTING_OP_SSH_SLICE_BYTES = 2_097_152

export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type TestingOpLogMarker = RangeOpLogMarker

const opLogMarkerAtStart = new Map<string, TestingOpLogMarker>()

function lineBody(line: string): string {
  return splitLeadingWallTimestamp(line).body
}

export async function noteTestingOpLogMarker(
  opId: string,
  cappedLog: string | null,
  rangeId: string,
): Promise<void> {
  const log = cappedLog ?? ""
  let sshFileBytes: number | null = null
  for (let i = 0; i < 3; i++) {
    sshFileBytes = await readLudusAnsibleLogByteLength(rangeId)
    if (sshFileBytes != null) break
    if (i < 2) await delayMs(400)
  }
  const marker: TestingOpLogMarker = {
    cappedLength: log.length,
    sshFileBytes,
    tailAnchor: log.slice(-TAIL_ANCHOR_CHARS),
  }
  opLogMarkerAtStart.set(opId, marker)
  saveRangeOpLogMarker(opId, marker)
}

export function clearTestingOpLogMarker(opId: string): void {
  opLogMarkerAtStart.delete(opId)
}

/** @deprecated */
export function clearTestingOpLogByteOffset(opId: string): void {
  clearTestingOpLogMarker(opId)
}

function getTestingOpLogMarker(opId: string): TestingOpLogMarker | null {
  return opLogMarkerAtStart.get(opId) ?? loadRangeOpLogMarker(opId)
}

export async function sliceLogSinceTestingOpMarker(
  rangeId: string,
  marker: TestingOpLogMarker,
  opts?: { taskLudusApiKey?: string },
): Promise<string | null> {
  const logs = await readLudusRangeLogsForReconcile(rangeId, opts)
  if (!logs?.trim()) {
    if (marker.sshFileBytes != null) {
      return readLudusAnsibleLogSuffixFromByteOffset(rangeId, marker.sshFileBytes, {
        maxBytes: TESTING_OP_SSH_SLICE_BYTES,
      })
    }
    return null
  }

  let slice: string | null = null

  // Prefer cappedLength when the HTTP tail grew — anchor lastIndexOf can match repeated
  // ansible boilerplate from an earlier run and drop the new PLAY RECAP from the slice.
  if (logs.length > marker.cappedLength) {
    slice = logs.slice(marker.cappedLength)
  }

  if (!slice?.trim()) {
    const currentBytes = await readLudusAnsibleLogByteLength(rangeId)
    if (
      marker.sshFileBytes != null &&
      currentBytes != null &&
      currentBytes > marker.sshFileBytes
    ) {
      slice = await readLudusAnsibleLogSuffixFromByteOffset(rangeId, marker.sshFileBytes, {
        maxBytes: TESTING_OP_SSH_SLICE_BYTES,
      })
    }
  }

  if (!slice?.trim() && marker.tailAnchor.length >= 128) {
    const searchFrom = Math.max(0, marker.cappedLength - marker.tailAnchor.length)
    const anchorIdx = logs.indexOf(marker.tailAnchor, searchFrom)
    if (anchorIdx >= 0) {
      slice = logs.slice(anchorIdx + marker.tailAnchor.length)
    } else {
      const lastIdx = logs.lastIndexOf(marker.tailAnchor)
      if (lastIdx >= searchFrom) {
        slice = logs.slice(lastIdx + marker.tailAnchor.length)
      }
    }
  }

  if (!slice?.trim() && marker.sshFileBytes != null) {
    slice = await readLudusAnsibleLogSuffixFromByteOffset(rangeId, marker.sshFileBytes, {
      maxBytes: TESTING_OP_SSH_SLICE_BYTES,
    })
  }

  if (!slice?.trim()) {
    const currentBytes = await readLudusAnsibleLogByteLength(rangeId)
    if (
      currentBytes != null &&
      marker.sshFileBytes != null &&
      currentBytes > marker.sshFileBytes
    ) {
      slice = await readLudusAnsibleLogSuffixFromByteOffset(rangeId, marker.sshFileBytes, {
        maxBytes: TESTING_OP_SSH_SLICE_BYTES,
      })
    }
  }

  return slice?.trim() ? slice : null
}

export async function readTestingOpLogSlice(
  opId: string,
  rangeId: string,
  ludusApiKey: string,
): Promise<string | null> {
  const marker = getTestingOpLogMarker(opId)
  if (marker?.sshFileBytes != null) {
    const currentBytes = await readLudusAnsibleLogByteLength(rangeId)
    if (currentBytes != null && currentBytes > marker.sshFileBytes) {
      const viaSsh = await readLudusAnsibleLogSuffixFromByteOffset(rangeId, marker.sshFileBytes, {
        maxBytes: TESTING_OP_SSH_SLICE_BYTES,
      })
      if (viaSsh?.trim()) return viaSsh
    }
  }
  if (marker) {
    return sliceLogSinceTestingOpMarker(rangeId, marker, { taskLudusApiKey: ludusApiKey })
  }
  return readLudusRangeLogsForReconcile(rangeId, { taskLudusApiKey: ludusApiKey })
}

function recapRunWindow(log: string, recapIdx: number): string {
  const prevRecap = log.lastIndexOf("PLAY RECAP", Math.max(0, recapIdx - 1))
  const start = prevRecap >= 0 ? prevRecap : Math.max(0, recapIdx - 120_000)
  return log.slice(start)
}

function newestCleanRecapIndex(log: string): number {
  let idx = log.length
  while (idx >= 0) {
    const found = log.lastIndexOf("PLAY RECAP", idx - 1)
    if (found < 0) return -1
    if (parseAnsibleRecapAllOk(log, found)) return found
    idx = found
  }
  return -1
}

function isTestingStartRunWindow(window: string): boolean {
  const hasSnapshot =
    /Take a snapshot of all VMs|Create new clean snapshot/i.test(window)
  const hasBlock =
    /Block VMs from accessing the internet|Remove the default external rule/i.test(window)
  return hasSnapshot && hasBlock
}

function isTestingStopRunWindow(window: string): boolean {
  if (isTestingStartRunWindow(window)) return false
  if (/Revert/i.test(window) && /snapshot/i.test(window)) return true
  if (/Allow the .* subnet|allow.*subnet.*internet|allow all outbound/i.test(window)) return true
  if (/Add the default external rule|Allow VMs to access the internet/i.test(window)) {
    return /\bchanged:\s*\[/i.test(window)
  }
  const flushIdx = window.lastIndexOf("Flush the LUDUS_TESTING table")
  if (flushIdx >= 0) {
    const afterFlush = window.slice(flushIdx)
    const flushTaskLine = afterFlush.split("\n")[0] ?? ""
    if (/changed:\s*\[/i.test(afterFlush) && !/skipping:/i.test(flushTaskLine)) {
      return true
    }
  }
  return false
}

/** Newest clean PLAY RECAP must match `opType` (avoids stale start recap after a newer stop). */
export function logSliceProvesOpComplete(opType: RangeOpType, log: string): boolean {
  if (!log.trim()) return false
  const recapIdx = newestCleanRecapIndex(log)
  if (recapIdx < 0) return false
  const window = recapRunWindow(log, recapIdx)
  if (opType === "testing_start") return isTestingStartRunWindow(window)
  if (opType === "testing_stop") return isTestingStopRunWindow(window)
  return false
}

/** Completed testing-start Ansible (snapshot + block internet) with failed=0. */
export function logIndicatesTestingStartComplete(log: string): boolean {
  if (!log.trim()) return false
  return logSliceProvesOpComplete("testing_start", log)
}

/** Completed testing-stop Ansible with failed=0. */
export function logIndicatesTestingStopComplete(log: string): boolean {
  if (!log.trim()) return false
  return logSliceProvesOpComplete("testing_stop", log)
}

export type CompletedTestingToggle = "start" | "stop"

export function inferCompletedTestingToggleFromLog(log: string): CompletedTestingToggle | null {
  if (logIndicatesTestingStopComplete(log)) return "stop"
  if (logIndicatesTestingStartComplete(log)) return "start"
  return null
}

/** True when ansible output proves this op finished successfully. */
export function testingOpLogSliceProvesComplete(
  opType: RangeOpType,
  logSlice: string | null | undefined,
): boolean {
  if (!logSlice?.trim()) return false
  return logSliceProvesOpComplete(opType, normalizeLogBodies(logSlice))
}

/** Patch PocketBase after ansible success. Failure is logged only — never fails the op. */
export async function bestEffortSyncPbTestingEnabled(
  rangeId: string,
  enabled: boolean,
  reason: string,
): Promise<boolean> {
  const err = await setPbTestingEnabled(rangeId, enabled)
  if (err) {
    console.warn(`[testing-op] ${reason} PB PATCH failed for ${rangeId}: ${err}`)
    return false
  }
  const after = await fetchPbRangeStatus(rangeId)
  if (after?.testingEnabled === enabled) {
    console.log(`[testing-op] ${reason} synced testingEnabled=${enabled} for ${rangeId}`)
    return true
  }
  console.warn(
    `[testing-op] ${reason} PB PATCH ok but still testingEnabled=${after?.testingEnabled} for ${rangeId}`,
  )
  return false
}

/** Retry PB sync — UI reads PB directly; await before marking op complete. */
export async function syncPbTestingEnabledWithRetries(
  rangeId: string,
  enabled: boolean,
  reason: string,
  maxAttempts = 5,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const ok = await bestEffortSyncPbTestingEnabled(
      rangeId,
      enabled,
      `${reason} (attempt ${i + 1}/${maxAttempts})`,
    )
    if (ok) return true
    if (i < maxAttempts - 1) await delayMs(800 * (i + 1))
  }
  return false
}

export async function ludusApiTestingEnabled(
  rangeId: string,
  apiKey: string,
  userOverride?: string,
): Promise<boolean | undefined> {
  const result = await ludusRequest<{ testingEnabled?: boolean }>(
    `/range?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey, userOverride },
  )
  if (!result.data) return undefined
  return result.data.testingEnabled
}

export function normalizeLogBodies(log: string): string {
  return log
    .split("\n")
    .map((l) => lineBody(l))
    .join("\n")
}

/** @internal tests */
export function sliceCappedLogSinceMarkerForTest(
  logs: string,
  marker: TestingOpLogMarker,
): string | null {
  if (logs.length > marker.cappedLength) {
    const viaCap = logs.slice(marker.cappedLength)
    if (viaCap.trim()) return viaCap
  }
  if (marker.tailAnchor.length >= 128) {
    const searchFrom = Math.max(0, marker.cappedLength - marker.tailAnchor.length)
    const anchorIdx = logs.indexOf(marker.tailAnchor, searchFrom)
    if (anchorIdx >= 0) return logs.slice(anchorIdx + marker.tailAnchor.length)
    const lastIdx = logs.lastIndexOf(marker.tailAnchor)
    if (lastIdx >= searchFrom) return logs.slice(lastIdx + marker.tailAnchor.length)
  }
  return null
}
