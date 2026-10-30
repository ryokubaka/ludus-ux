/**
 * Browser sessionStorage for EFI enroll preview — survives page refresh so
 * Start Testing confirm can show power-off notice without waiting on SSH probe.
 * Invalidated when the range gains a new VMID (fingerprint), not by TTL.
 */

export type SessionEfiStopPreview = {
  ok: boolean
  notice: string | null
  candidates: Array<{ vmid: number; name: string; node: string }>
  error?: string
  cached?: boolean
  /** Sorted unique Proxmox VMIDs from last probe — used to detect new VMs. */
  vmFingerprint?: string
  checkedAt: number
}

const PREFIX = "lux-efi-stop-preview:v1:"

function key(rangeId: string): string {
  return `${PREFIX}${rangeId}`
}

/** True when `next` includes any VMID not in `prev` (range grew). */
export function sessionEfiFingerprintGainedVms(prevFp: string, nextFp: string): boolean {
  const prev = new Set(
    prevFp
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0),
  )
  const next = nextFp
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (next.length === 0) return false
  return next.some((id) => !prev.has(id))
}

export function readSessionEfiStopPreview(rangeId: string): SessionEfiStopPreview | null {
  if (typeof sessionStorage === "undefined") return null
  try {
    const raw = sessionStorage.getItem(key(rangeId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionEfiStopPreview
    if (!parsed || typeof parsed !== "object") return null
    return {
      ok: parsed.ok !== false,
      notice: parsed.notice ?? null,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      error: parsed.error,
      cached: true,
      vmFingerprint: typeof parsed.vmFingerprint === "string" ? parsed.vmFingerprint : undefined,
      checkedAt: typeof parsed.checkedAt === "number" ? parsed.checkedAt : Date.now(),
    }
  } catch {
    return null
  }
}

export function writeSessionEfiStopPreview(
  rangeId: string,
  preview: Omit<SessionEfiStopPreview, "checkedAt"> & { checkedAt?: number },
): void {
  if (typeof sessionStorage === "undefined") return
  try {
    const payload: SessionEfiStopPreview = {
      ok: preview.ok,
      notice: preview.notice,
      candidates: preview.candidates,
      error: preview.error,
      cached: preview.cached,
      vmFingerprint: preview.vmFingerprint,
      checkedAt: preview.checkedAt ?? Date.now(),
    }
    sessionStorage.setItem(key(rangeId), JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

export function clearSessionEfiStopPreview(rangeId: string): void {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.removeItem(key(rangeId))
  } catch {
    /* ignore */
  }
}
