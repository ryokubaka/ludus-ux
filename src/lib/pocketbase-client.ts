/**
 * PocketBase client — server-side only.
 *
 * Ludus is built on top of PocketBase, so the same host:port that serves the
 * Ludus API (LUDUS_URL) also exposes the PocketBase REST API under /api/ paths
 * (no /api/v2 prefix).
 *
 * Authentication: PocketBase "superuser" / admin account.
 *   email:    root@ludus.internal  (hardcoded by Ludus)
 *   password: LUDUS_ROOT_API_KEY   (from settings / .env)
 *
 * The auth token is cached in process-memory and refreshed after 23 hours (well
 * within the default 30-day PocketBase admin token lifetime).
 *
 * TLS verification follows the same NODE_TLS_REJECT_UNAUTHORIZED flag that the
 * rest of the app uses (controlled by LUDUS_VERIFY_TLS / settings.verifyTls).
 */

import { getSettings } from "./settings-store"
import type { RangeObject, UserObject, RangeState } from "./types"

const PB_EMAIL = "root@ludus.internal"

/**
 * Escape a value for PocketBase filter string literals, e.g. field = "VALUE".
 * Unescaped `"` or `\` in rangeID/userID breaks the filter parser → HTTP 400.
 */
function escapePbFilterLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

// Two endpoints to try: PocketBase >= v0.20 uses _superusers, older uses admins.
const AUTH_ENDPOINTS = [
  "/api/collections/_superusers/auth-with-password",
  "/api/admins/auth-with-password",
]

// ── Token cache ───────────────────────────────────────────────────────────────

interface CachedToken {
  token: string
  expiresAt: number
}

let _token: CachedToken | null = null
let _authInFlight: Promise<string | null> | null = null

async function authenticate(): Promise<string | null> {
  const settings = getSettings()
  const password = settings.rootApiKey
  if (!password) return null

  const base = settings.ludusUrl.replace(/\/$/, "")

  for (const endpoint of AUTH_ENDPOINTS) {
    try {
      const res = await fetch(`${base}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: PB_EMAIL, password }),
        cache: "no-store",
      })
      if (!res.ok) continue
      const data = await res.json() as { token?: string }
      if (data.token) return data.token
    } catch {
      // Try next endpoint
    }
  }

  console.warn("[pocketbase] Authentication failed — is LUDUS_ROOT_API_KEY set?")
  return null
}

async function getToken(): Promise<string | null> {
  // Return cached token if still fresh (5 min safety buffer)
  if (_token && Date.now() < _token.expiresAt - 5 * 60_000) {
    return _token.token
  }

  // Deduplicate concurrent auth requests
  if (_authInFlight) return _authInFlight

  _authInFlight = authenticate().then((token) => {
    if (token) {
      // Refresh after 23 h (default token lifetime is 30 days)
      _token = { token, expiresAt: Date.now() + 23 * 60 * 60_000 }
    }
    _authInFlight = null
    return token
  })

  return _authInFlight
}

/** Invalidate the cached token (e.g. after a 401). */
export function bustPbTokenCache(): void {
  _token = null
}

// ── Collection fetcher ────────────────────────────────────────────────────────

interface PbListResponse<T> {
  items: T[]
  totalItems: number
}

async function fetchAll<T>(
  collection: string,
  token: string,
  extra?: Record<string, string>,
): Promise<T[]> {
  const settings = getSettings()
  const base = settings.ludusUrl.replace(/\/$/, "")
  const items: T[] = []
  let page = 1

  while (true) {
    const url = new URL(`${base}/api/collections/${collection}/records`)
    url.searchParams.set("perPage", "500")
    url.searchParams.set("page", String(page))
    if (extra) {
      for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })

    if (!res.ok) {
      if (res.status === 401) bustPbTokenCache()
      throw new Error(`PocketBase [${collection}] HTTP ${res.status}`)
    }

    const body = await res.json() as PbListResponse<T>
    items.push(...body.items)
    if (items.length >= body.totalItems) break
    page++
  }

  return items
}

// ── Field mappers ─────────────────────────────────────────────────────────────
//
// PocketBase stores fields using the names defined in the collection schema.
// Ludus's Go models use camelCase, so we expect camelCase field names.
// Unknown / renamed fields fall through to sensible defaults.

type Row = Record<string, unknown>

function str(r: Row, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] != null && r[k] !== "") return String(r[k])
  }
  return ""
}

function num(r: Row, ...keys: string[]): number {
  for (const k of keys) {
    const n = Number(r[k])
    if (!isNaN(n) && r[k] != null) return n
  }
  return 0
}

function bool(r: Row, key: string): boolean {
  return Boolean(r[key])
}

function mapRange(r: Row): RangeObject {
  // rangeID: Ludus stores the human-readable range slug here.
  // For default ranges it equals the userID; named ranges have a distinct value.
  // PocketBase's auto-generated `id` is our last resort.
  const rangeID = str(r, "rangeID", "id")

  return {
    rangeID,
    name: str(r, "name", "rangeID") || rangeID,
    rangeNumber: num(r, "rangeNumber"),
    rangeState: (str(r, "rangeState") || "NEVER DEPLOYED") as RangeState,
    lastDeployment: str(r, "lastDeployment") || undefined,
    numberOfVMs: num(r, "numberOfVMs"),
    testingEnabled: bool(r, "testingEnabled"),
    description: str(r, "description") || undefined,
    purpose: str(r, "purpose") || undefined,
    VMs: [], // Live Proxmox VM state is not persisted in PocketBase
    userID: str(r, "userID") || undefined,
    allowedDomains: Array.isArray(r.allowedDomains)
      ? (r.allowedDomains as string[])
      : undefined,
    allowedIPs: Array.isArray(r.allowedIPs)
      ? (r.allowedIPs as string[])
      : undefined,
  }
}

function mapUser(u: Row): UserObject {
  return {
    userID: str(u, "userID", "id"),
    name: str(u, "name") || undefined,
    isAdmin: bool(u, "isAdmin"),
    proxmoxUsername: str(u, "proxmoxUsername") || undefined,
    email: str(u, "email") || undefined,
    defaultRangeID: str(u, "defaultRangeID", "rangeID") || undefined,
    dateCreated: str(u, "dateCreated", "created") || undefined,
    dateLastActive: str(u, "dateLastActive", "lastActivity", "updated") || undefined,
    userNumber: num(u, "userNumber") || undefined,
    portforwardingEnabled:
      u.portforwardingEnabled != null ? bool(u, "portforwardingEnabled") : undefined,
  }
}

// ── Single-range and per-user range status ────────────────────────────────────

/**
 * Fetch a single range's status directly from PocketBase by its rangeID.
 *
 * PocketBase is the authoritative store for testingEnabled and rangeState —
 * the Ludus REST API reads from it and may add a caching layer on top.
 * Querying PocketBase directly avoids those delays, making status checks
 * (especially completion detection for testing-mode ops) much more reliable.
 *
 * Returns null when PocketBase is unavailable or the range isn't found.
 * Callers should fall back to the Ludus API on null.
 */
export async function fetchPbRangeStatus(rangeId: string): Promise<RangeObject | null> {
  try {
    if (!rangeId?.trim()) return null
    const token = await getToken()
    if (!token) return null

    const settings = getSettings()
    const base = settings.ludusUrl.replace(/\/$/, "")

    const url = new URL(`${base}/api/collections/ranges/records`)
    url.searchParams.set("filter", `rangeID = "${escapePbFilterLiteral(rangeId.trim())}"`)
    url.searchParams.set("perPage", "1")

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })

    if (!res.ok) {
      if (res.status === 401) bustPbTokenCache()
      return null
    }

    const body = await res.json() as { items?: Row[] }
    const record = body.items?.[0]
    if (!record) return null

    return mapRange(record)
  } catch (err) {
    console.warn("[pocketbase] fetchPbRangeStatus failed:", (err as Error).message)
    return null
  }
}

/**
 * Tracks whether the server-side `userID = "…"` filter is known to fail on
 * this PocketBase/Ludus deployment.  Set to true on first failure so all
 * subsequent calls skip the doomed filter and go straight to a full scan,
 * avoiding repeated 400 warnings in the logs.
 */
let _rangesFilterBroken = false

/**
 * Fetch all ranges owned by a specific Ludus userID from PocketBase.
 *
 * Used to build the range-selector status dots in the Testing page without
 * depending on the Ludus REST API for per-range testingEnabled state.
 *
 * Returns an empty array when PocketBase is unavailable.
 */
export async function fetchPbUserRanges(userId: string): Promise<RangeObject[]> {
  try {
    if (!userId?.trim()) return []
    const token = await getToken()
    if (!token) return []

    const uid = userId.trim()

    // Do NOT pass PocketBase `sort=` here — some Ludus/PB builds omit `rangeNumber`
    // on the schema index or rename fields, which returns HTTP 400 for the whole
    // list request. Sort client-side after mapRange instead.
    let rows: Row[]
    if (!_rangesFilterBroken) {
      const filterExpr = `userID = "${escapePbFilterLiteral(uid)}"`
      try {
        rows = await fetchAll<Row>("ranges", token, { filter: filterExpr })
      } catch (firstErr) {
        // Filter is invalid on this PB/Ludus version (field type or name mismatch).
        // Remember this for the lifetime of the process — subsequent calls will
        // skip straight to the full-scan path and won't log this warning again.
        _rangesFilterBroken = true
        console.log(
          `[pocketbase] ranges filter not supported on this server — using full-scan fallback (this is normal on some Ludus builds):`,
          (firstErr as Error).message,
        )
        const all = await fetchAll<Row>("ranges", token)
        rows = all.filter((row) => str(row as Row, "userID") === uid)
      }
    } else {
      // Filter is known to fail on this deployment; go straight to full scan.
      const all = await fetchAll<Row>("ranges", token)
      rows = all.filter((row) => str(row as Row, "userID") === uid)
    }

    return rows
      .map(mapRange)
      .filter((r) => !!r.rangeID)
      .sort((a, b) => (a.rangeNumber ?? 0) - (b.rangeNumber ?? 0))
  } catch (err) {
    console.warn("[pocketbase] fetchPbUserRanges failed:", (err as Error).message)
    return []
  }
}

/**
 * Overlay PocketBase state for each range by rangeID (one PB read per range).
 * Use when the list query `userID = "…"` fails but single-record fetch works.
 * Ludus GET /range provides the range list; PB remains source of truth for
 * testingEnabled, rangeState, allowedDomains, etc.
 */
export async function enrichRangesWithPbRecords(ranges: RangeObject[]): Promise<RangeObject[]> {
  const merged = await Promise.all(
    ranges.map(async (r) => {
      if (!r.rangeID?.trim()) return r
      const pb = await fetchPbRangeStatus(r.rangeID.trim())
      return pb ? { ...r, ...pb, rangeID: r.rangeID } : r
    }),
  )
  return merged.sort((a, b) => (a.rangeNumber ?? 0) - (b.rangeNumber ?? 0))
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface PbAdminData {
  ranges: RangeObject[]
  users: UserObject[]
}

/**
 * Updates the `isAdmin` flag for a Ludus user directly in PocketBase.
 *
 * Steps:
 *  1. Authenticate to get a PocketBase bearer token.
 *  2. Query the `users` collection by `userID` to get the PocketBase record ID.
 *  3. PATCH that record with `{ isAdmin: <value> }`.
 *
 * Returns an error string on failure, or null on success.
 */
export async function setPbUserAdmin(
  targetUserID: string,
  isAdmin: boolean,
): Promise<string | null> {
  try {
    const token = await getToken()
    if (!token) return "PocketBase authentication failed — check LUDUS_ROOT_API_KEY"

    const settings = getSettings()
    const base = settings.ludusUrl.replace(/\/$/, "")

    // Find the PocketBase record ID for this Ludus userID
    const searchUrl = new URL(`${base}/api/collections/users/records`)
    searchUrl.searchParams.set("filter", `userID = "${escapePbFilterLiteral(targetUserID)}"`)
    searchUrl.searchParams.set("perPage", "1")

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!searchRes.ok) {
      if (searchRes.status === 401) bustPbTokenCache()
      return `PocketBase user lookup failed: HTTP ${searchRes.status}`
    }

    const searchBody = await searchRes.json() as { items?: Array<{ id: string }> }
    const record = searchBody.items?.[0]
    if (!record?.id) return `User "${targetUserID}" not found in PocketBase`

    // Patch the isAdmin field
    const patchRes = await fetch(`${base}/api/collections/users/records/${record.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isAdmin }),
      cache: "no-store",
    })

    if (!patchRes.ok) {
      if (patchRes.status === 401) bustPbTokenCache()
      const errBody = await patchRes.json().catch(() => ({})) as { message?: string }
      return `PocketBase PATCH failed: HTTP ${patchRes.status} ${errBody.message ?? ""}`
    }

    return null // success
  } catch (err) {
    return `PocketBase error: ${(err as Error).message}`
  }
}

/**
 * Transfers ownership of a Ludus range to a new user by updating `userID`
 * directly in PocketBase.  The Ludus REST API has no ownership-transfer
 * endpoint (only a sharing/assign endpoint which grants access rather than
 * changing the owner field).
 *
 * Returns an error string on failure, or null on success.
 */
export async function setPbRangeOwner(
  rangeId: string,
  newOwnerUserId: string,
): Promise<string | null> {
  try {
    const token = await getToken()
    if (!token) return "PocketBase authentication failed — check LUDUS_ROOT_API_KEY"

    const settings = getSettings()
    const base = settings.ludusUrl.replace(/\/$/, "")

    // Find the PocketBase record ID for this Ludus rangeID
    const searchUrl = new URL(`${base}/api/collections/ranges/records`)
    searchUrl.searchParams.set("filter", `rangeID = "${escapePbFilterLiteral(rangeId)}"`)
    searchUrl.searchParams.set("perPage", "1")

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!searchRes.ok) {
      if (searchRes.status === 401) bustPbTokenCache()
      return `PocketBase range lookup failed: HTTP ${searchRes.status}`
    }

    const searchBody = await searchRes.json() as { items?: Array<{ id: string }> }
    const record = searchBody.items?.[0]
    if (!record?.id) return `Range "${rangeId}" not found in PocketBase`

    // PATCH the userID field to transfer ownership
    const patchRes = await fetch(`${base}/api/collections/ranges/records/${record.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userID: newOwnerUserId }),
      cache: "no-store",
    })

    if (!patchRes.ok) {
      if (patchRes.status === 401) bustPbTokenCache()
      const errBody = await patchRes.json().catch(() => ({})) as { message?: string }
      return `PocketBase PATCH failed: HTTP ${patchRes.status} ${errBody.message ?? ""}`
    }

    return null // success
  } catch (err) {
    return `PocketBase error: ${(err as Error).message}`
  }
}

/**
 * Fetches all ranges + users from PocketBase in two parallel requests.
 *
 * Returns null when:
 *  - LUDUS_ROOT_API_KEY is not configured
 *  - Authentication fails (wrong key or PocketBase unreachable)
 *  - Any collection query fails
 *
 * Callers should fall back to the Ludus API on null.
 */
export async function fetchPbAdminData(): Promise<PbAdminData | null> {
  try {
    const token = await getToken()
    if (!token) return null

    const [pbRanges, pbUsers] = await Promise.all([
      fetchAll<Row>("ranges", token),
      fetchAll<Row>("users", token),
    ])

    const ranges = pbRanges
      .map(mapRange)
      .filter((r) => r.rangeID) // discard unmappable records
      .sort((a, b) => (a.rangeNumber ?? 0) - (b.rangeNumber ?? 0))

    const users = pbUsers
      .map(mapUser)
      .filter((u) => u.userID)

    return { ranges, users }
  } catch (err) {
    console.warn("[pocketbase] fetchPbAdminData failed:", (err as Error).message)
    return null
  }
}
