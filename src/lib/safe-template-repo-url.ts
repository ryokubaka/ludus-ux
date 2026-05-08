/**
 * Validates user-supplied GitLab HTTP API base URLs for template listing/fetch.
 * Mitigates SSRF: only https, block loopback/link-local/private/reserved IPv4 literals
 * and obvious local hostnames.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "metadata.google.internal",
  "metadata.goog",
])

function isPrivateOrReservedIpv4(octets: number[]): boolean {
  const [a, b] = octets
  if (a === 0 || a === 127) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0 && octets[2] === 0) return true
  if (a === 192 && b === 0 && octets[2] === 2) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 224 || a >= 240) return true
  return false
}

function parseIpv4(hostname: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return null
  const parts = [1, 2, 3, 4].map((i) => Number(m[i]))
  if (parts.some((n) => n > 255 || n < 0)) return null
  return parts
}

/** Returns normalized apiBase (no trailing slash) or an error message. */
export function assertSafeTemplateRepoUrl(repoUrl: string): { ok: true; apiBase: string } | { ok: false; error: string } {
  const raw = repoUrl.trim()
  if (!raw) return { ok: false, error: "repoUrl is empty" }

  let url: URL
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`)
  } catch {
    return { ok: false, error: "repoUrl is not a valid URL" }
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "repoUrl must use https://" }
  }

  if (url.username || url.password) {
    return { ok: false, error: "Credentials in repoUrl are not allowed" }
  }

  const host = url.hostname.toLowerCase()
  if (!host) return { ok: false, error: "repoUrl has no hostname" }
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, error: "Hostname is not allowed" }
  if (host.endsWith(".local") || host.endsWith(".localhost")) {
    return { ok: false, error: "Hostname is not allowed" }
  }

  const ipv4 = parseIpv4(host)
  if (ipv4 && isPrivateOrReservedIpv4(ipv4)) {
    return { ok: false, error: "Private or reserved IPv4 addresses are not allowed" }
  }

  if (host.includes(":")) {
    return { ok: false, error: "IPv6 repo hosts are not supported for custom sources" }
  }

  const pathClean = url.pathname.replace(/\/+$/, "") || ""
  const apiBase = `${url.origin}${pathClean}`.replace(/\/$/, "")
  return { ok: true, apiBase }
}
