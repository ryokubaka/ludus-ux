/**
 * Central TLS policy for server-side HTTPS/WSS to Ludus, PocketBase, Proxmox, and GitLab.
 *
 * Default: Node verifies certificates (secure). Self-signed or private CA: mount certs
 * via NODE_EXTRA_CA_CERTS or your platform trust store.
 *
 * Lab / known-bad-cert deployments: set LUDUS_TLS_INSECURE=true to disable verification
 * (same effect as the former unconditional NODE_TLS_REJECT_UNAUTHORIZED=0).
 */

export function isLudusTlsInsecure(): boolean {
  const v = process.env.LUDUS_TLS_INSECURE?.trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes"
}

/** Apply process-wide Node TLS behavior from env (call once at process start). */
export function applyNodeTlsFromLudusEnv(): void {
  if (isLudusTlsInsecure()) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  }
}
