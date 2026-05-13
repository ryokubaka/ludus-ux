/**
 * Non-empty `LUDUS_ROOT_API_KEY` wins over SQLite/UI-saved `rootApiKey` so stale DB
 * rows cannot mask a valid container env secret.
 */

/** Strip Docker/.env quirks (CRLF, BOM, wrapping quotes) from stored keys. */
export function normalizeLudusApiKeyInput(value: string | undefined): string {
  if (value == null) return ""
  let t = value.replace(/\r/g, "").replace(/^\uFEFF/, "").trim()
  if (t.length >= 2) {
    const open = t[0]
    const close = t[t.length - 1]
    if ((open === '"' && close === '"') || (open === "'" && close === "'")) {
      t = t.slice(1, -1).trim()
    }
  }
  return t
}

export function resolveRootApiKey(envValue: string | undefined, dbValue: string | undefined): string {
  const fromEnv = normalizeLudusApiKeyInput(envValue)
  if (fromEnv) return fromEnv
  return normalizeLudusApiKeyInput(dbValue)
}

/** True when a non-empty `LUDUS_ROOT_API_KEY` env var overrides any SQLite value. */
export function isLudusRootApiKeyEnvOverrideActive(): boolean {
  return !!normalizeLudusApiKeyInput(process.env.LUDUS_ROOT_API_KEY)
}
