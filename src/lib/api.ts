/**
 * Client-side API helper — calls Next.js proxy routes at /api/proxy/[...path].
 * Paths match Ludus Server v2.x API (the proxy adds the /api/v2 prefix server-side).
 */

/**
 * Read active impersonation state from sessionStorage (browser only).
 * Returns BOTH headers needed for full server-side impersonation support:
 *   X-Impersonate-Apikey  – used by the proxy to call Ludus as the target user
 *   X-Impersonate-As      – used by custom routes to know the effective username
 */
export function getImpersonationHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = sessionStorage.getItem("goad_impersonation")
    if (raw) {
      const { apiKey, username } = JSON.parse(raw)
      const h: Record<string, string> = {}
      if (apiKey)   h["X-Impersonate-Apikey"] = apiKey
      if (username) h["X-Impersonate-As"]     = username
      return h
    }
  } catch {}
  return {}
}

/** Convenience: just the API key (used in places that only need the key). */
export function getImpersonationApiKey(): string | null {
  return getImpersonationHeaders()["X-Impersonate-Apikey"] ?? null
}

export async function apiRequest<T = unknown>(
  path: string,
  options: {
    method?: string
    body?: unknown
    useAdmin?: boolean
    userOverride?: string
  } = {}
): Promise<{ data?: T; error?: string; status: number }> {
  const { method = "GET", body, useAdmin, userOverride } = options

  // Remove leading slash for the proxy path; empty string → /api/proxy/ (root)
  const proxyPath = path === "/" ? "" : (path.startsWith("/") ? path.slice(1) : path)
  const url = `/api/proxy/${proxyPath}`

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (useAdmin) headers["X-Ludus-Admin"] = "true"
  if (userOverride) headers["X-Ludus-User"] = userOverride

  // Inject both impersonation headers so every server-side route can determine
  // the effective API key (X-Impersonate-Apikey) AND effective username
  // (X-Impersonate-As) without requiring per-call configuration.
  Object.assign(headers, getImpersonationHeaders())

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const status = response.status
    if (status === 204) return { status }

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return { error: data?.error || `HTTP ${status}`, status }
    }
    return { data: data as T, status }
  } catch (err) {
    return { error: (err as Error).message, status: 0 }
  }
}

export const get = <T>(path: string, opts?: Parameters<typeof apiRequest>[1]) =>
  apiRequest<T>(path, { ...opts, method: "GET" })

export const post = <T>(path: string, body?: unknown, opts?: Parameters<typeof apiRequest>[1]) =>
  apiRequest<T>(path, { ...opts, method: "POST", body })

export const put = <T>(path: string, body?: unknown, opts?: Parameters<typeof apiRequest>[1]) =>
  apiRequest<T>(path, { ...opts, method: "PUT", body })

export const del = <T>(path: string, body?: unknown, opts?: Parameters<typeof apiRequest>[1]) =>
  apiRequest<T>(path, { ...opts, method: "DELETE", body })

// ── Ludus API wrappers (Ludus Server v2.x paths) ─────────────────────────────

export const ludusApi = {
  // Version — GET /
  getVersion: () => get<{ result: string; version?: string }>("/"),

  // Current user info — GET /user (returns array)
  whoami: () => get<import("./types").UserObject[]>("/user"),

  // Own user info — GET /user
  listUsers: (opts?: { useAdmin?: boolean }) =>
    get<import("./types").UserObject[]>("/user", opts),

  // All users — GET /user/all (admin only)
  listAllUsers: () =>
    get<import("./types").UserObject[]>("/user/all"),

  // Range — GET /range
  getRangeStatus: (rangeId?: string) =>
    get<import("./types").RangeObject>(rangeId ? `/range?rangeID=${rangeId}` : "/range"),

  // All ranges (admin) — GET /range/all
  listAllRanges: () =>
    get<import("./types").RangeObject[]>("/range/all"),

  /**
   * Returns ALL ranges across all users (admin only, uses /range/all).
   * For regular users, falls back to /range.
   * NOTE: use getRangesForUser() on the Testing page — this function returns
   * every user's ranges for admins, which is not useful for per-user operations.
   */
  getRanges: async (): Promise<{ data?: import("./types").RangeObject[]; error?: string; status: number }> => {
    const all = await get<import("./types").RangeObject[]>("/range/all")
    if (!all.error && Array.isArray(all.data)) return all
    const single = await get<import("./types").RangeObject | import("./types").RangeObject[]>("/range")
    if (!single.data) return { error: single.error, status: single.status }
    const data = Array.isArray(single.data) ? single.data : [single.data]
    return { data, status: single.status }
  },

  /**
   * Returns only the ranges belonging to the currently authenticated user
   * (or impersonated user).  Always uses GET /range so it's scoped by the
   * API key in use — safe for admin and non-admin alike.
   */
  getRangesForUser: async (): Promise<{ data?: import("./types").RangeObject[]; error?: string; status: number }> => {
    const result = await get<import("./types").RangeObject | import("./types").RangeObject[]>("/range")
    if (!result.data) return { error: result.error, status: result.status }
    const data = Array.isArray(result.data) ? result.data : [result.data]
    return { data, status: result.status }
  },

  // Accessible ranges — GET /ranges/accessible
  listAccessibleRanges: () =>
    get<import("./types").RangeAccessEntry[]>("/ranges/accessible"),


  // Range config — GET /range/config → {"result":"yaml..."}
  getRangeConfig: (rangeId?: string) =>
    get<{ result: string }>(rangeId ? `/range/config?rangeID=${rangeId}` : "/range/config"),

  // Upload range config YAML (routed through dedicated endpoint that sends multipart/form-data)
  setRangeConfig: async (yaml: string, rangeId?: string, force?: boolean): Promise<{ data?: { result: string }; error?: string; status: number }> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    Object.assign(headers, getImpersonationHeaders())
    try {
      const res = await fetch("/api/range/config", {
        method: "PUT",
        headers,
        body: JSON.stringify({ config: yaml, rangeId, force }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) return { error: data?.error || `HTTP ${res.status}`, status: res.status }
      return { data, status: res.status }
    } catch (err) {
      return { error: (err as Error).message, status: 0 }
    }
  },

  // Delete a range — destroys all VMs, removes Proxmox pool, removes PocketBase record.
  // force=true is required to delete even when VMs still exist.
  deleteRange: (rangeId: string) =>
    del(`/range?rangeID=${encodeURIComponent(rangeId)}&force=true`),

  // Deployment
  deployRange: (tags?: string[], limit?: string, rangeId?: string) => {
    const q = rangeId ? `?rangeID=${rangeId}` : ""
    return post(`/range/deploy${q}`, tags?.length || limit ? { tags, limit } : undefined)
  },
  abortDeploy: (rangeId?: string) =>
    post(rangeId ? `/range/abort?rangeID=${rangeId}` : "/range/abort"),

  // Deploy tags — GET /range/tags
  getDeployTags: () => get<{ result: string }>("/range/tags"),

  // Logs — GET /range/logs → {"cursor":N,"result":"log text"}
  getRangeLogs: (rangeId?: string) =>
    get<{ cursor: number; result: string }>(rangeId ? `/range/logs?rangeID=${rangeId}` : "/range/logs"),

  // etc/hosts — GET /range/etchosts → {"result":"hosts string"}
  getRangeEtcHosts: (rangeId?: string) =>
    get<{ result: string }>(rangeId ? `/range/etchosts?rangeID=${rangeId}` : "/range/etchosts"),

  // SSH config — GET /range/sshconfig
  getRangeSSHConfig: (rangeId?: string) =>
    get<{ result: string }>(rangeId ? `/range/sshconfig?rangeID=${rangeId}` : "/range/sshconfig"),

  // RDP configs — GET /range/rdpconfigs
  getRangeRDPConfigs: (rangeId?: string) =>
    get<{ result: string }>(rangeId ? `/range/rdpconfigs?rangeID=${rangeId}` : "/range/rdpconfigs"),

  // Range creation — routed through dedicated endpoint that proxies to admin API (port 8081)
  createRange: async (data: { name: string; rangeID: string; description?: string; purpose?: string; userID?: string[] }): Promise<{ data?: { result: string }; error?: string; status: number }> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    Object.assign(headers, getImpersonationHeaders())
    try {
      const res = await fetch("/api/range/create", {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      })
      const resData = await res.json().catch(() => null)
      if (!res.ok) return { error: resData?.error || `HTTP ${res.status}`, status: res.status }
      return { data: resData, status: res.status }
    } catch (err) {
      return { error: (err as Error).message, status: 0 }
    }
  },

  // Templates — GET /templates → [{name, built, status}]
  listTemplates: () => get<import("./types").TemplateObject[]>("/templates"),
  getTemplateStatus: () => get<import("./types").TemplateObject[] | null>("/templates/status"),
  buildTemplates: (names: string[]) => post("/templates", { templates: names }),
  abortTemplateBuild: () => post("/templates/abort"),
  deleteTemplate: (name: string) => del(`/template/${name}`),
  getTemplateLogs: () => get<{ cursor: number; result: string }>("/templates/logs"),

  // Ansible roles+collections — GET /ansible → [{name, version, type}]
  listAnsible: () => get<import("./types").AnsibleItem[]>("/ansible"),
  listRoles: () => get<import("./types").AnsibleItem[]>("/ansible"),
  listCollections: () => get<import("./types").AnsibleItem[]>("/ansible"),
  // Ludus v2 role endpoint: POST /ansible/role — field "role", action "install"|"remove"
  addRole: (name: string, version?: string) =>
    post("/ansible/role", { role: name, action: "install", ...(version ? { version } : {}) }),
  removeRole: (name: string) =>
    post("/ansible/role", { role: name, action: "remove" }),
  // Ludus v2 collection endpoint: POST /ansible/collection — field "collection" (no action field)
  addCollection: (name: string, version?: string) =>
    post("/ansible/collection", { collection: name, ...(version ? { version } : {}) }),
  removeCollection: (name: string) =>
    post("/ansible/collection", { collection: name, force: true }),

  // Wireguard — GET /user/wireguard
  getUserWireguard: (_userId?: string) =>
    get<{ result: { wireGuardConfig: string } }>("/user/wireguard"),

  // API key — GET /user/apikey → returns the current key without changing it
  getUserApiKey: (userId?: string) =>
    get<{ result: string; apiKey?: string }>(
      "/user/apikey",
      userId ? { userOverride: userId } : undefined
    ),

  // Roll/regenerate API key — POST /user/apikey
  regenerateApiKey: (userId?: string) =>
    post<{ result: string; apiKey?: string }>(
      "/user/apikey",
      undefined,
      userId ? { userOverride: userId } : undefined
    ),

  // User credentials — GET /user/credentials
  getUserCredentials: () =>
    get<{ username: string; password: string }>("/user/credentials"),

  // Range power actions — PUT /range/poweron|poweroff with {"machines": [...names]}
  powerOn: (vmNames?: string[], rangeId?: string) => {
    const q = rangeId ? `?rangeID=${rangeId}` : ""
    return put(`/range/poweron${q}`, { machines: vmNames ?? [] })
  },
  powerOff: (vmNames?: string[], rangeId?: string) => {
    const q = rangeId ? `?rangeID=${rangeId}` : ""
    return put(`/range/poweroff${q}`, { machines: vmNames ?? [] })
  },

  // Testing mode (rangeId selects which range in Ludus v2 multi-range environments)
  getTestingStatus: (rangeId?: string) =>
    get<import("./types").RangeObject>(rangeId ? `/range?rangeID=${rangeId}` : "/range"),
  startTesting: (rangeId?: string) =>
    put(rangeId ? `/testing/start?rangeID=${rangeId}` : "/testing/start"),
  stopTesting: (rangeId?: string) =>
    put(rangeId ? `/testing/stop?rangeID=${rangeId}` : "/testing/stop"),
  // POST /testing/allow and /testing/deny expect { domains?: string[], ips?: string[] }
  allowDomain: (domain: string, rangeId?: string) =>
    post(rangeId ? `/testing/allow?rangeID=${rangeId}` : "/testing/allow", { domains: [domain] }),
  denyDomain: (domain: string, rangeId?: string) =>
    post(rangeId ? `/testing/deny?rangeID=${rangeId}` : "/testing/deny", { domains: [domain] }),
  allowIP: (ip: string, rangeId?: string) =>
    post(rangeId ? `/testing/allow?rangeID=${rangeId}` : "/testing/allow", { ips: [ip] }),
  denyIP: (ip: string, rangeId?: string) =>
    post(rangeId ? `/testing/deny?rangeID=${rangeId}` : "/testing/deny", { ips: [ip] }),

  // Snapshots — v2 paths
  listSnapshots: () => get<import("./types").SnapshotListResponse>("/snapshots/list"),
  createSnapshot: (payload: import("./types").SnapshotCreatePayload) =>
    post("/snapshots/create", payload),
  revertSnapshot: (payload: import("./types").SnapshotCreatePayload) =>
    post("/snapshots/rollback", payload),
  deleteSnapshot: (payload: import("./types").SnapshotCreatePayload) =>
    post("/snapshots/remove", payload),

  // Blueprints — v2 paths
  listBlueprints: () => get<import("./types").BlueprintListItem[]>("/blueprints"),
  createBlueprintFromRange: () =>
    post("/blueprints/from-range"),
  getBlueprintConfig: (id: string) => get<{ result: string }>(`/blueprints/${id}/config`),
  updateBlueprintConfig: (id: string, config: string) =>
    put(`/blueprints/${id}/config`, config),
  applyBlueprint: (id: string) =>
    post(`/blueprints/${id}/apply`),
  copyBlueprint: (id: string) =>
    post(`/blueprints/${id}/copy`),
  deleteBlueprint: (id: string) => del(`/blueprints/${id}`),
  shareBlueprintWithUsers: (id: string, userIDs: string[]) =>
    post(`/blueprints/${id}/share/users`, { userIDs }),
  shareBlueprintWithGroups: (id: string, groupNames: string[]) =>
    post(`/blueprints/${id}/share/groups`, { groupNames }),
  getBlueprintAccessUsers: (id: string) =>
    get<import("./types").BlueprintAccessUserItem[]>(`/blueprints/${id}/access/users`),
  getBlueprintAccessGroups: (id: string) =>
    get<import("./types").BlueprintAccessUserItem[]>(`/blueprints/${id}/access/groups`),

  // Users admin — POST /user and DELETE /user/:id
  // These go to the Ludus admin port (8081) using the logged-in admin's own API key.
  // In Ludus v2 the ROOT key is PocketBase-only; regular admin ops use the user's key.
  addUser: (userId: string, name?: string, isAdmin?: boolean, email?: string) =>
    post("/user", { userID: userId, name, isAdmin, email: email || `${userId}@ludus.internal` }, { useAdmin: true }),

  // DELETE /user/{userID}?deleteDefaultRange=true
  // deleteDefaultRange=true atomically removes the user's default range from Proxmox
  // AND removes the user from PocketBase in a single admin API call.
  deleteUser: <T = unknown>(userId: string, deleteDefaultRange = false) =>
    del<T>(
      `/user/${encodeURIComponent(userId)}${deleteDefaultRange ? "?deleteDefaultRange=true" : ""}`,
      undefined,
      { useAdmin: true }
    ),

  // Set Proxmox/Ludus password for a user — POST /user/credentials (port 8080).
  // Admin can set another user's password by including userID in the body.
  setUserCredentials: (userId: string, proxmoxPassword: string) =>
    post<{ result: string }>("/user/credentials", { userID: userId, proxmoxPassword }),

  // Range deletion — DELETE /range?userID=<id>[&rangeID=<id>]&force=true
  // rangeID selects a specific range (required when user has multiple ranges).
  // force=true destroys all VMs first; without it Ludus returns 409.
  deleteUserRange: (userId: string, rangeId?: string) =>
    del(
      `/range?userID=${encodeURIComponent(userId)}${rangeId ? `&rangeID=${encodeURIComponent(rangeId)}` : ""}&force=true`,
      undefined,
      { useAdmin: true }
    ),

  // Groups — v2 paths
  listGroups: () => get<import("./types").GroupObject[]>("/groups"),
  createGroup: (name: string) => post("/groups", { groupName: name }),
  deleteGroup: (name: string) => del(`/groups/${name}`),
  addUsersToGroup: (group: string, userIds: string[]) =>
    post(`/groups/${group}/users`, { userIDs: userIds }),
  removeUsersFromGroup: (group: string, userIds: string[]) =>
    del(`/groups/${group}/users`, { userIDs: userIds }),
  listGroupMembers: (group: string) =>
    get<import("./types").UserObject[]>(`/groups/${group}/users`),
  getUserMemberships: () =>
    get<import("./types").GroupObject[]>("/user/memberships"),

  // Range access sharing — v2: ranges/assign (admin only), ranges/revoke
  // POST /ranges/assign/{userID}/{rangeID} is on port 8080 with admin API key auth
  assignRange: (userId: string, rangeId: string) =>
    post(`/ranges/assign/${encodeURIComponent(userId)}/${encodeURIComponent(rangeId)}`),
  revokeRange: (userId: string, rangeId: string) =>
    del(`/ranges/revoke/${userId}/${rangeId}`),
  listRangeUsers: (rangeId: string) =>
    get<import("./types").UserObject[]>(`/ranges/${rangeId}/users`),
}
