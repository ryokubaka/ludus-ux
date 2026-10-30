/**
 * Log lines that may contain request data. Newlines are removed so a value
 * cannot forge a second log record. Percent signs are doubled so a value used
 * as a format string cannot consume later arguments. Secret env values are
 * replaced before the line is written.
 */

const SECRET_ENV_NAME = /KEY|SECRET|PASSWORD|TOKEN|PASS/i

function secretEnvValues(): string[] {
  const values: string[] = []
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 8) continue
    if (!SECRET_ENV_NAME.test(name)) continue
    values.push(value)
  }
  return values
}

function redactSecrets(text: string): string {
  let out = text
  for (const secret of secretEnvValues()) {
    if (!out.includes(secret)) continue
    out = out.split(secret).join("[redacted]")
  }
  return out
}

/** Newlines removed and secrets redacted. Percent signs are left as written. */
export function sanitizeLogArgument(value: string): string {
  return redactSecrets(value).replace(/\n/g, "").replace(/\r/g, "")
}

/**
 * Safe to pass as a format string: newlines removed, `%` doubled, secrets redacted.
 */
export function sanitizeLogMessage(value: string): string {
  return sanitizeLogArgument(value).replace(/%/g, "%%")
}

function emit(write: (...args: unknown[]) => void, message: string): void {
  write("%s", sanitizeLogMessage(message))
}

export function logInfo(message: string): void {
  emit(console.log, message)
}

export function logWarn(message: string): void {
  emit(console.warn, message)
}

export function logError(message: string): void {
  emit(console.error, message)
}
