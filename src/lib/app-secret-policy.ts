/**
 * Production startup checks for APP_SECRET (session + settings encryption).
 */

const DOCUMENTED_WEAK_SECRETS = new Set([
  "change-me-in-production",
  "change-me-in-production-32-chars!!",
  "change-me-to-a-random-secret-string-32-chars",
])

const MIN_SECRET_LENGTH = 32

/** Non-null when production must refuse to start. */
export function getProductionAppSecretFailureMessage(): string | null {
  if (process.env.NODE_ENV !== "production") return null

  const raw = process.env.APP_SECRET
  const s = typeof raw === "string" ? raw.trim() : ""

  if (!s) {
    return "APP_SECRET is required in production. Set a random value (e.g. openssl rand -hex 32) in the environment."
  }
  if (s.length < MIN_SECRET_LENGTH) {
    return `APP_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production (got ${s.length}).`
  }
  if (DOCUMENTED_WEAK_SECRETS.has(s)) {
    return "APP_SECRET must not use a placeholder value from .env.example or docker-compose defaults."
  }
  return null
}
