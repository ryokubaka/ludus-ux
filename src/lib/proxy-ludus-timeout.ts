/**
 * Per-request Ludus await timeout for `/api/proxy` → `ludusRequest`.
 * Default 30s is too short for Proxmox-backed work (deploy, power, snapshots, …).
 */

const DEFAULT_MS = 30_000
const SLOW_MS = 120_000
const VERY_SLOW_MS = 5 * 60_000

/** Ludus user + Linux provisioning (POST /user, credentials, GET /user/apikey) — same ceiling as heavy range ops on slow hardware. */
export const LUDUS_USER_PROVISION_TIMEOUT_MS = VERY_SLOW_MS

/**
 * @param path Ludus path only (no query), e.g. `/range/deploy`
 * @param method HTTP method (case-insensitive)
 */
export function getProxyLudusTimeoutMs(path: string, method: string): number {
  const m = method.toUpperCase()

  if (m === "GET" && /\/range\/ansibleinventory\b/i.test(path)) return SLOW_MS

  if (m === "POST" && /^\/snapshots\/(create|rollback|remove)\b/.test(path)) return VERY_SLOW_MS

  if (m === "POST" && /\/range\/deploy\b/.test(path)) return VERY_SLOW_MS

  if (m === "POST" && /^\/templates\b/.test(path)) return VERY_SLOW_MS

  if (m === "POST" && /\/blueprints\/[^/]+\/apply\b/.test(path)) return VERY_SLOW_MS

  if (m === "POST" && /^\/blueprints\/from-range\b/.test(path)) return SLOW_MS

  if (m === "POST" && /^\/testing\/(allow|deny)\b/.test(path)) return VERY_SLOW_MS

  if (m === "PUT" && /\/range\/(poweron|poweroff)\b/.test(path)) return VERY_SLOW_MS

  if (m === "POST" && /\/range\/abort\b/.test(path)) return SLOW_MS

  if (m === "DELETE" && /^\/range\b/.test(path)) return VERY_SLOW_MS

  if (m === "DELETE" && /\/range\/[^/]+\/vms\b/.test(path)) return VERY_SLOW_MS

  if (m === "DELETE" && /^\/vm\//.test(path)) return VERY_SLOW_MS

  if (m === "POST" && /^\/ansible\/(role|collection)\b/.test(path)) return SLOW_MS

  if ((m === "POST" || m === "DELETE") && /^\/groups\/[^/]+\/(users|ranges)$/.test(path)) return SLOW_MS

  // Ludus drives Proxmox/Linux user creation — often >30s on slow clusters.
  if (
    (m === "POST" && /^\/user\/?$/i.test(path)) ||
    (m === "POST" && /^\/user\/credentials\/?$/i.test(path)) ||
    (m === "GET" && /^\/user\/apikey\b/i.test(path))
  ) {
    return LUDUS_USER_PROVISION_TIMEOUT_MS
  }

  return DEFAULT_MS
}
