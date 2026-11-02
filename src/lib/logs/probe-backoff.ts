/**
 * Backoff for the background SSH probes.
 *
 * The deploy-log clock probes the host every couple of seconds. A rejected
 * credential is an auth failure on the host, and OpenSSH 10 penalises the
 * source address for each one. Probing that fast turns one wrong credential
 * into a penalty that also refuses the login SSH connection. Failures
 * therefore back off instead of hammering.
 */

export const PROBE_BASE_MS = 2_000
export const PROBE_MAX_BACKOFF_MS = 60_000

/** Delay before the next probe after `consecutiveFailures` failures. 0 when healthy. */
export function probeBackoffMs(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) return 0
  const exponent = Math.min(Math.floor(consecutiveFailures), 6)
  return Math.min(PROBE_BASE_MS * 2 ** exponent, PROBE_MAX_BACKOFF_MS)
}
