/**
 * Ludus creates the PocketBase superuser `root@ludus.internal` once, when the
 * root API key file does not exist yet, and sets that password from the file.
 * A later key change updates the Ludus user hash only. LUX still sends
 * LUDUS_ROOT_API_KEY as the superuser password.
 */

export type PocketBaseAuthAttempt = {
  endpoint: string
  status?: number
  error?: string
}

const AUTH_WARN_INTERVAL_MS = 10 * 60_000

let lastWarnAt = 0
let lastWarnText = ""

export function explainPocketBaseAuthFailure(
  attempts: PocketBaseAuthAttempt[],
  keySet: boolean,
): string {
  if (!keySet) {
    return "PocketBase login skipped: LUDUS_ROOT_API_KEY is empty."
  }
  const rejected = attempts.find((attempt) => attempt.status === 400)
  if (rejected) {
    return (
      "PocketBase rejected LUDUS_ROOT_API_KEY as the password for root@ludus.internal. " +
      "Ludus accepts this value as the ROOT API key. It copies that key into the superuser password only when the root user is first created, and a later key change does not update it. " +
      "Set the superuser password to the current root API key."
    )
  }
  const failed = attempts.find((attempt) => attempt.error)
  if (failed?.error && /certificate|unable to verify/i.test(failed.error)) {
    return (
      `PocketBase login did not reach Ludus (${failed.error}). ` +
      "For the default self-signed certificate, set LUDUS_TLS_INSECURE=true and recreate the container, or trust the CA with NODE_EXTRA_CA_CERTS."
    )
  }
  if (failed?.error) {
    return `PocketBase login failed: ${failed.error}`
  }
  const statuses = attempts
    .map((attempt) => `${attempt.endpoint} HTTP ${attempt.status ?? "no response"}`)
    .join("; ")
  return `PocketBase login failed${statuses ? ` (${statuses})` : ""}.`
}

/** One warning per distinct message per 10 minutes. Range polls call this constantly. */
export function warnPocketBaseAuthFailure(message: string, now = Date.now()): void {
  if (message === lastWarnText && now - lastWarnAt < AUTH_WARN_INTERVAL_MS) return
  lastWarnText = message
  lastWarnAt = now
  console.warn(`[pocketbase] ${message}`)
}

export function resetPocketBaseAuthWarningForTests(): void {
  lastWarnAt = 0
  lastWarnText = ""
}
