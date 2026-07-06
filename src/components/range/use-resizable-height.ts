import { useEffect } from "react"

/**
 * Height-only user resize for a scroll container.
 *
 * Seeds the element's height from `localStorage` (or `defaultHeight`) on mount,
 * then persists the user's dragged height. The actual drag grip is provided by
 * the CSS `resize: vertical` on the element; this hook only handles the initial
 * height and persistence so React re-renders never fight the user's drag.
 */
export function useResizableHeight(
  enabled: boolean,
  ref: React.RefObject<HTMLElement | null>,
  opts: { storageKey?: string; defaultHeight?: number | null },
): void {
  const { storageKey, defaultHeight } = opts

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    let initial: number | null = defaultHeight ?? null
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey)
        const n = raw ? parseInt(raw, 10) : NaN
        if (Number.isFinite(n) && n > 0) initial = n
      } catch {
        /* localStorage unavailable — fall back to default */
      }
    }
    // Only pin an explicit height when we have one; otherwise leave the element's
    // natural (CSS/flex) height until the user drags the grip.
    if (initial != null) el.style.height = `${initial}px`

    if (!storageKey) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      const h = el.offsetHeight
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, String(Math.round(h)))
        } catch {
          /* ignore persistence failures */
        }
      }, 300)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [enabled, ref, storageKey, defaultHeight])
}

/** Parse a CSS length like "400px" into a number; returns fallback for non-px values. */
export function parsePxHeight(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const m = value.match(/^(\d+)px$/)
  return m ? parseInt(m[1], 10) : fallback
}
