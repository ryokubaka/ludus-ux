/**
 * Central TLS policy for server-side HTTPS/WSS to Ludus, PocketBase, Proxmox, and GitLab.
 *
 * Default: Node verifies certificates (secure). Self-signed or private CA: mount certs
 * via NODE_EXTRA_CA_CERTS or your platform trust store.
 *
 * Lab / known-bad-cert deployments: set LUDUS_TLS_INSECURE=true so Ludus, PocketBase,
 * and Proxmox calls skip certificate checks. That flag does not disable TLS
 * verification for the rest of the process.
 */

export function isLudusTlsInsecure(): boolean {
  const v = process.env.LUDUS_TLS_INSECURE?.trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes"
}

/**
 * Fix for a Ludus certificate that does not verify. Compose passes an empty
 * value when .env has no LUDUS_TLS_INSECURE, which before 1.5.0 meant true.
 */
export function ludusTlsCertificateHint(): string {
  if (isLudusTlsInsecure()) return ""
  if (!process.env.LUDUS_TLS_INSECURE?.trim()) {
    return (
      " LUDUS_TLS_INSECURE is not set in .env. Before 1.5.0 that meant the certificate was not checked; it is now verified." +
      " If Ludus uses its default self-signed certificate, add LUDUS_TLS_INSECURE=true to .env and run docker compose up -d," +
      " or trust its CA with NODE_EXTRA_CA_CERTS."
    )
  }
  return " If Ludus uses a self-signed certificate, set LUDUS_TLS_INSECURE=true in .env (lab only) or add the CA via NODE_EXTRA_CA_CERTS."
}

export function isCertificateError(detail: string): boolean {
  return /unable to verify the first certificate|self[- ]signed|certificate/i.test(detail)
}

/** Apply process-wide Node TLS behavior from env (call once at process start). */
export function applyNodeTlsFromLudusEnv(): void {
  // Intentionally empty. LUDUS_TLS_INSECURE is scoped to Ludus, PocketBase, and
  // Proxmox through ludusFetch. GitHub and other HTTPS stay verified.
}
