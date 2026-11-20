const CLOCK: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", second: "2-digit" }

/** Clock time for a message sent today. An older message includes the date. */
export function formatLuxaiMessageTime(createdAt: number, now = Date.now()): string {
  const date = new Date(createdAt)
  if (!Number.isFinite(createdAt) || Number.isNaN(date.getTime())) return ""
  if (date.toDateString() === new Date(now).toDateString()) {
    return date.toLocaleTimeString(undefined, CLOCK)
  }
  return date.toLocaleString(undefined, { month: "short", day: "numeric", ...CLOCK })
}
