export function safeClientError(
  err: unknown,
  fallback = "Request failed",
): string {
  if (process.env.NODE_ENV !== "production") {
    if (err instanceof Error && err.message) return err.message
    if (typeof err === "string" && err) return err
  }
  return fallback
}

export function logAndSafeError(
  context: string,
  err: unknown,
  fallback = "Request failed",
): string {
  const detail = err instanceof Error ? err.message : String(err)
  console.error(`[${context}]`, detail)
  return safeClientError(err, fallback)
}
