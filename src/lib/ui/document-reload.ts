const RELOAD_AT_KEY = "lux-error-reload-at"
const RELOAD_WINDOW_MS = 30_000

/** Reload once per half minute. A crash that survives that reload stays on the error screen. */
export function reloadDocumentOnce(): boolean {
  if (typeof window === "undefined") return false
  try {
    const previous = Number(sessionStorage.getItem(RELOAD_AT_KEY) || "0")
    if (Number.isFinite(previous) && Date.now() - previous < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function reloadDocument(): void {
  window.location.reload()
}
