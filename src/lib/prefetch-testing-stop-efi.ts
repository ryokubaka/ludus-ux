/**
 * Fire-and-forget EFI enroll preview warm-up before testing **start** snapshot.
 * Hits GET /api/range/testing-stop-preflight so SQLite + sessionStorage are ready
 * for Start Testing confirm copy.
 *
 * Re-probes only when session is missing or the range gained a new VMID.
 */

import { getImpersonationHeaders } from "@/lib/api"
import {
  readSessionEfiStopPreview,
  sessionEfiFingerprintGainedVms,
  writeSessionEfiStopPreview,
  type SessionEfiStopPreview,
} from "@/lib/testing-stop-efi-session"

const inFlight = new Set<string>()

export type EfiPreflightApiResult = {
  ok: boolean
  notice: string | null
  candidates: Array<{ vmid: number; name: string; node: string }>
  error?: string
  cached?: boolean
  vmFingerprint?: string | null
}

/** Fetch preflight and write sessionStorage. Returns null on network/HTTP failure. */
export async function fetchAndStoreEfiPreflight(
  rangeId: string,
): Promise<EfiPreflightApiResult | null> {
  const id = rangeId.trim()
  if (!id) return null
  try {
    const res = await fetch(
      `/api/range/testing-stop-preflight?rangeId=${encodeURIComponent(id)}`,
      { headers: { ...getImpersonationHeaders() }, credentials: "include" },
    )
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      notice?: string | null
      candidates?: Array<{ vmid: number; name: string; node: string }>
      error?: string
      cached?: boolean
      vmFingerprint?: string | null
    }
    if (!res.ok) return null
    const result: EfiPreflightApiResult = {
      ok: data.ok !== false,
      notice: data.notice ?? null,
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
      error: data.error,
      cached: data.cached,
      vmFingerprint: data.vmFingerprint ?? null,
    }
    writeSessionEfiStopPreview(id, {
      ok: result.ok,
      notice: result.notice,
      candidates: result.candidates,
      error: result.error,
      cached: result.cached,
      vmFingerprint: result.vmFingerprint ?? undefined,
    })
    return result
  } catch {
    return null
  }
}

/**
 * Prefetch for one range when session is empty, or refresh when fingerprint gained.
 * Skips network when session exists and a concurrent fetch is not already running
 * for a forced validate — callers use `forceValidate` on range select.
 */
export async function prefetchTestingStopEfiForRange(
  rangeId: string,
  opts?: { forceValidate?: boolean },
): Promise<void> {
  const id = rangeId.trim()
  if (!id || inFlight.has(id)) return

  const existing = readSessionEfiStopPreview(id)
  if (existing && !opts?.forceValidate) return

  inFlight.add(id)
  try {
    if (existing && opts?.forceValidate) {
      const result = await fetchAndStoreEfiPreflight(id)
      if (!result) return
      const prevFp = existing.vmFingerprint ?? ""
      const nextFp = result.vmFingerprint ?? ""
      // If fingerprint did not gain VMs, keep notice/candidates from prior session
      // when API returned the same set (already written). If gained, write already
      // replaced session with fresh probe.
      if (prevFp && nextFp && !sessionEfiFingerprintGainedVms(prevFp, nextFp)) {
        // Already stored by fetchAndStore; nothing else
      }
      return
    }
    await fetchAndStoreEfiPreflight(id)
  } finally {
    inFlight.delete(id)
  }
}

/** Prefetch selected range only when session is empty (or validate fingerprint). */
export function prefetchTestingStopEfiForSelectedRange(
  selectedRangeId: string | null | undefined,
  opts?: { forceValidate?: boolean },
): void {
  const id = selectedRangeId?.trim()
  if (!id) return
  void prefetchTestingStopEfiForRange(id, opts)
}

/** @deprecated Use prefetchTestingStopEfiForSelectedRange */
export function prefetchTestingStopEfiForTestingRanges(
  _ranges: Array<{ rangeID?: string; testingEnabled?: boolean } | null | undefined>,
  opts?: { selectedRangeId?: string | null },
): void {
  prefetchTestingStopEfiForSelectedRange(opts?.selectedRangeId, { forceValidate: false })
}

export function sessionPreviewToNotice(preview: SessionEfiStopPreview | EfiPreflightApiResult): {
  notice: string | null
  count: number
} {
  return {
    notice: preview.notice,
    count: preview.candidates.length,
  }
}
