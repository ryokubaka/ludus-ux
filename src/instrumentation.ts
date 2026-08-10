import { applyNodeTlsFromLudusEnv } from "@/lib/tls-insecure-env"
import { getProductionAppSecretFailureMessage } from "@/lib/app-secret-policy"

/**
 * Server TLS: same policy as `server/ws-server.ts` (Docker runs `node ws-server.js`).
 * See `LUDUS_TLS_INSECURE` in `.env.example`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    applyNodeTlsFromLudusEnv()
    const secretErr = getProductionAppSecretFailureMessage()
    if (secretErr) {
      throw new Error(`[ludus-ux] ${secretErr}`)
    }
    // Periodic Ludus source git pulls so catalog/install tip stays current.
    const { startSourceAutoSyncLoop } = await import("@/lib/source-auto-sync")
    startSourceAutoSyncLoop()
  }
}
