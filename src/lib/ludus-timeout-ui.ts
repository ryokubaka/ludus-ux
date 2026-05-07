/**
 * Client UX when `/api/proxy` waited on Ludus longer than `ludusRequest` allows
 * (or the request was aborted). The operation may still complete server-side.
 */

/** Matches `ludusRequest` abort copy in {@link ./ludus-client}. */
export function isLudusAwaitResponseTimeoutMessage(message: string): boolean {
  return /connection timed out|timed out after|request was aborted/i.test(message)
}

const PROGRESS_HINT =
  "Ludus may still be processing — refresh in a moment, open range logs, or check Proxmox."

export function ludusSlowHttpToastDescription(error: string): string {
  return `${error} ${PROGRESS_HINT}`
}

export function tryToastLudusSlowHttpError(options: {
  toast: (opts: { title: string; description?: string; variant?: "destructive" | "default" }) => void
  error: string
  slowTitle: string
  onSlow?: () => void
}): boolean {
  if (!isLudusAwaitResponseTimeoutMessage(options.error)) return false
  options.toast({
    title: options.slowTitle,
    description: ludusSlowHttpToastDescription(options.error),
  })
  options.onSlow?.()
  return true
}
