/**
 * GET /api/range/allowed-domains?rangeId=xxx
 *
 * Returns the current allowed domains/IPs for a range by querying the Ludus
 * API.  Tries multiple strategies to work around the known Ludus/PocketBase
 * sync bug where `GET /range` sometimes returns an empty `allowedDomains`
 * even though iptables rules are active:
 *
 *   1. Standard API (port 8080) with the user's API key
 *   2. Admin API (port 8081) with the ROOT API key
 *
 * The testing page uses this endpoint instead of relying solely on the
 * `allowedDomains` field from `GET /range`, which is unreliable.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { getSettings } from "@/lib/settings-store"

export const dynamic = "force-dynamic"

interface RangeData {
  allowedDomains?: string[]
  allowedIPs?: string[]
  testingEnabled?: boolean
  [key: string]: unknown
}

function getEffective(
  request: NextRequest,
  session: { apiKey: string; username: string; isAdmin: boolean },
) {
  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  return {
    effectiveApiKey: impersonateApiKey || session.apiKey,
  }
}

/**
 * Extract all allowed entries from a Ludus range response.
 *
 * Ludus stores two separate fields in PocketBase:
 *   • allowedDomains — entries added via POST /testing/allow { domains: [...] }
 *                      Format: "example.com (1.2.3.4)" or bare "example.com"
 *   • allowedIPs     — entries added via POST /testing/allow { ips: [...] }
 *                      Format: bare IP string e.g. "8.8.8.8"
 *
 * We merge both so the UI shows every rule regardless of how it was added.
 * IPs that already appear embedded in an allowedDomains entry (e.g.
 * "example.com (8.8.8.8)") are deduplicated so they don't show twice.
 */
function extractAllowedDomains(data: unknown): string[] {
  if (!data || typeof data !== "object") return []
  // Handle both single object and array responses
  const obj = Array.isArray(data) ? data[0] : data
  if (!obj || typeof obj !== "object") return []
  const d = obj as Record<string, unknown>

  const domains: string[] = Array.isArray(d.allowedDomains) ? (d.allowedDomains as string[]) : []
  const ips: string[]     = Array.isArray(d.allowedIPs)     ? (d.allowedIPs     as string[]) : []

  if (ips.length === 0) return domains

  // Build the set of IPs already referenced inside domain entries
  // e.g. "example.com (1.2.3.4)" → "1.2.3.4"
  const embeddedIPs = new Set<string>()
  for (const entry of domains) {
    const m = entry.match(/\((\d+\.\d+\.\d+\.\d+)\)/)
    if (m) embeddedIPs.add(m[1])
  }

  // Append IPs not already represented in the domains list
  const extraIPs = ips.filter((ip) => !embeddedIPs.has(ip))
  return [...domains, ...extraIPs]
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const rangeId = request.nextUrl.searchParams.get("rangeId")
  if (!rangeId) {
    return NextResponse.json({ error: "rangeId required" }, { status: 400 })
  }

  const { effectiveApiKey } = getEffective(request, session)
  const settings = getSettings()
  const rangePath = `/range?rangeID=${encodeURIComponent(rangeId)}`

  // Strategy 1: Standard API with the user's API key
  let domains: string[] = []
  try {
    const result = await ludusRequest<RangeData>(rangePath, {
      apiKey: effectiveApiKey,
    })
    domains = extractAllowedDomains(result.data)
  } catch {}

  // Strategy 2: Admin API with ROOT API key (if available and strategy 1 came up empty)
  if (domains.length === 0 && settings.rootApiKey && settings.ludusAdminUrl) {
    try {
      const result = await ludusRequest<RangeData>(rangePath, {
        apiKey: settings.rootApiKey,
        useAdminEndpoint: true,
      })
      const adminDomains = extractAllowedDomains(result.data)
      if (adminDomains.length > 0) {
        domains = adminDomains
        console.log(`[allowed-domains] standard API returned empty, admin API found ${domains.length} entries for ${rangeId}`)
      }
    } catch {}
  }

  return NextResponse.json({ allowedDomains: domains })
}
