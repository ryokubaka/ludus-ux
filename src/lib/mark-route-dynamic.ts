import { connection } from "next/server"

/** Route handlers that read cookies/session/SSH must await this under cacheComponents. */
export async function markRouteDynamic(): Promise<void> {
  try {
    await connection()
  } catch (err) {
    // Vitest and other non-request callers invoke session helpers without AsyncLocalStorage.
    if (err instanceof Error && err.message.includes("outside a request scope")) return
    throw err
  }
}
