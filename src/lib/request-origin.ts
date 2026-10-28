import type { NextRequest } from "next/server"

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * Mutating browser requests must come from this app's own origin.
 * SameSite does not distinguish ports, so Proxmox on :8006 is rejected here.
 * Non-browser clients that send neither Origin nor Sec-Fetch-Site are allowed.
 *
 * The browser sets Sec-Fetch-Site and a page cannot override it, so
 * `same-origin` is trusted as is. A proxy that drops the port from Host
 * (lux.example:8443 → lux.example) would otherwise fail the comparison below.
 */
export function requestOriginAllowed(request: Pick<NextRequest, "method" | "headers">): boolean {
  if (!MUTATING.has(request.method.toUpperCase())) return true

  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite === "same-origin") return true
  if (fetchSite && fetchSite !== "none") return false

  const origin = request.headers.get("origin")
  if (!origin) return true

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }

  const hostHeader = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").trim()
  const hostName = hostHeader.split(":")[0]?.toLowerCase() ?? ""
  if (!hostName || originUrl.hostname.toLowerCase() !== hostName) return false

  const defaultPort = originUrl.protocol === "https:" ? "443" : "80"
  const hostPort = hostHeader.includes(":") ? hostHeader.slice(hostHeader.lastIndexOf(":") + 1) : defaultPort
  const originPort = originUrl.port || defaultPort
  return originPort === hostPort
}
