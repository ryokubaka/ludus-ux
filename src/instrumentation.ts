/**
 * Server TLS: same policy as `server/ws-server.ts` (Docker runs `node ws-server.js`).
 * Node `fetch` uses the TLS stack; Ludus/PocketBase are often self-signed / cluster CA.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  }
}
