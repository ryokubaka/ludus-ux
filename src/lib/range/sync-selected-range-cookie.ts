/**
 * Mirror sidebar range selection to an httpOnly cookie for server prefetch.
 * Fire-and-forget — never blocks UI.
 */
export function syncSelectedRangeCookie(rangeId: string | null): void {
  void fetch("/api/session/selected-range", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ rangeId }),
  }).catch(() => {})
}
