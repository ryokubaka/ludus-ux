/**
 * Helpers for surfacing template-install failures to the user.
 *
 * When installing via the Ludus Sources API fails with a non-404 error, the
 * route falls back to the SSH path. If that also fails we must not hide the
 * original Sources error — otherwise the user only ever sees the SSH symptom.
 */

/** Combine an SSH-fallback failure message with the earlier Sources failure (if any). */
export function combineTemplateFailure(
  sshMessage: string,
  sourcesMessage?: string,
): string {
  const ssh = sshMessage.trim()
  const src = sourcesMessage?.trim()
  if (!src) return ssh
  if (!ssh) return src
  return `${ssh}\n(Ludus Sources also failed: ${src})`
}
