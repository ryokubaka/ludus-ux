/**
 * Shared optimistic "this range just got aborted" marker.
 *
 * Why this exists
 * ---------------
 * When the user clicks Abort (on the Dashboard or from the GOAD page's Stop /
 * Force Abort flow), Ludus accepts the abort but takes a few seconds — and
 * sometimes much longer — to actually transition the range out of
 * `DEPLOYING` / `WAITING`. During that window every Ludus `GET /range` poll
 * still reports `DEPLOYING`, which caused the Dashboard to:
 *
 *   - flip back to "Deploying…" and re-show the Abort button,
 *   - auto-reopen Deploy Logs, and
 *   - restart the deploy SSE stream,
 *
 * giving the very real appearance that the deploy had "come back to life"
 * and forcing the user to click Abort again until the server-side state
 * finally caught up.
 *
 * A sessionStorage-backed flag is the simplest cross-page signal: both
 * `_dashboard.tsx` and `goad/[id]/page.tsx` call `markRangeAborting()` on a
 * successful abort, and both check `isRangeAborting()` before flipping the
 * UI back into a deploy-active state. The flag auto-expires after
 * `ABORT_GRACE_MS` so a genuinely stuck range eventually re-shows the Abort
 * control.
 */

const STORAGE_PREFIX = "ludus-ui:aborting:"
/** Grace window during which we trust our own abort over Ludus's state. */
export const ABORT_GRACE_MS = 20_000

function key(rangeId: string) {
  return `${STORAGE_PREFIX}${rangeId}`
}

/** Record that this range was just aborted. Safe to call on the server (no-op). */
export function markRangeAborting(rangeId: string): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(key(rangeId), String(Date.now() + ABORT_GRACE_MS))
  } catch {
    // sessionStorage can be blocked in some embedded contexts; ignore.
  }
}

/** Clear the marker explicitly (e.g. once the range leaves DEPLOYING). */
export function clearRangeAborting(rangeId: string): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(key(rangeId))
  } catch {
    // ignore
  }
}

/** True while the grace window for this range hasn't expired. */
export function isRangeAborting(rangeId: string | null | undefined): boolean {
  if (!rangeId || typeof window === "undefined") return false
  try {
    const raw = sessionStorage.getItem(key(rangeId))
    if (!raw) return false
    const expiresAt = parseInt(raw, 10)
    if (!Number.isFinite(expiresAt)) return false
    if (Date.now() >= expiresAt) {
      sessionStorage.removeItem(key(rangeId))
      return false
    }
    return true
  } catch {
    return false
  }
}
