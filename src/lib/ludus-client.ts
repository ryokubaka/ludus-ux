/**
 * Ludus API client - server-side only, used in Next.js API routes.
 * Settings are read from the runtime settings store (which starts from env vars
 * and can be overridden at runtime via the Settings page).
 *
 * Ludus v2 uses /api/v2 as the base path for all API endpoints.
 */

import { getSettings, type RuntimeSettings } from "./settings-store"

/** When `ludusAdminUrl` is blank, derive admin base from main Ludus URL (`:8080`→`:8081`, or default port→8081). */
function inferAdminBaseFromLudusUrl(mainUrl: string): string {
  const t = mainUrl.trim().replace(/\/$/, "")
  if (!t) return t
  if (/:8080\b/.test(t)) return t.replace(/:8080\b/, ":8081")
  try {
    const u = new URL(t)
    if (u.port === "") {
      u.port = "8081"
      return u.href.replace(/\/$/, "")
    }
  } catch {
    /* ignore */
  }
  return t
}

/** Resolved admin API base URL (no trailing slash) for outbound Ludus admin calls. */
export function resolveLudusAdminApiBase(settings: Pick<RuntimeSettings, "ludusUrl" | "ludusAdminUrl">): string {
  const admin = settings.ludusAdminUrl?.trim()
  if (admin) return admin.replace(/\/$/, "")
  return inferAdminBaseFromLudusUrl(settings.ludusUrl).replace(/\/$/, "")
}

/** Session or impersonation Ludus API key first; optional ROOT for headless/automation. */
export function ludusRangeCreateApiKey(sessionKey: string | undefined, rootApiKey: string | undefined): string {
  return (sessionKey || "").trim() || (rootApiKey || "").trim() || ""
}

/** Walk Error.cause (Node fetch) so logs/UI show ECONNREFUSED etc., not only "fetch failed". */
function describeFetchFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts: string[] = [err.message]
  let c: unknown = err.cause
  for (let i = 0; i < 6 && c instanceof Error; i++) {
    parts.push(c.message)
    c = c.cause
  }
  return parts.join(" — ")
}

export interface LudusRequestOptions {
  method?: string
  body?: unknown
  apiKey?: string
  useAdminEndpoint?: boolean
  userOverride?: string
  /** Milliseconds before the request is aborted. Defaults to 30 000 ms. Pass 0 for no timeout. */
  timeout?: number
}

export async function ludusRequest<T = unknown>(
  path: string,
  options: LudusRequestOptions = {},
): Promise<{ data?: T; error?: string; status: number }> {
  const {
    method = "GET",
    body,
    apiKey = "",
    useAdminEndpoint = false,
    userOverride,
    timeout = 30_000,
  } = options

  const settings = getSettings()
  let baseUrl = settings.ludusUrl.trim()
  if (useAdminEndpoint) {
    baseUrl = resolveLudusAdminApiBase(settings)
  }

  // Build URL — prepend /api/v2 for Ludus v2 API.
  // The root path "/" maps to "/api/v2/" (the version endpoint).
  const cleanBase = baseUrl.replace(/\/$/, "").trim()
  if (!cleanBase) {
    return {
      error:
        "Ludus base URL is empty — set LUDUS_URL / Ludus API URL in Settings, or clear blank overrides (SQLite stored '' for an optional URL).",
      status: 0,
    }
  }
  const cleanPath = path === "/" ? "/" : (path.startsWith("/") ? path : "/" + path)
  // Only add /api/v2 if not already present
  const apiPath = cleanPath.startsWith("/api/v2") ? cleanPath : `/api/v2${cleanPath}`
  const url = `${cleanBase}${apiPath}`

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-KEY": apiKey,
  }

  if (userOverride) {
    headers["X-Impersonate-User"] = userOverride
  }

  const controller = new AbortController()
  const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
      cache: "no-store",
      signal: controller.signal,
    }

    if (body !== undefined) {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body)
    }

    const response = await fetch(url, fetchOptions)
    if (timeoutId) clearTimeout(timeoutId)
    const status = response.status

    if (status === 204) {
      return { status }
    }

    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const data = await response.json()
      if (!response.ok) {
        let errMsg = data?.error || `HTTP ${status}`
        if (status === 401 && useAdminEndpoint) {
          errMsg = `${String(errMsg)} — confirm **Admin API URL** reaches Ludus admin (port 8081 / ludus-admin) and the API key is valid for that listener.`
        }
        return { error: errMsg, status }
      }
      return { data: data as T, status }
    } else {
      const text = await response.text()
      if (!response.ok) {
        return { error: text || `HTTP ${status}`, status }
      }
      return { data: text as unknown as T, status }
    }
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId)
    if (err instanceof Error && err.name === "AbortError") {
      const sec = timeout > 0 ? Math.round(timeout / 1000) : 0
      return {
        error:
          sec > 0
            ? `Connection timed out after ${sec} s — the Ludus server did not finish responding. Long jobs (e.g. snapshots on many VMs) may still be running; wait and refresh, or check Proxmox.`
            : "Request was aborted before Ludus responded.",
        status: 0,
      }
    }
    const detail = describeFetchFailure(err)
    console.warn("[ludusRequest]", method, url, detail)
    return { error: `Connection failed: ${detail}`, status: 0 }
  }
}

export const ludusGet = <T>(path: string, opts?: Omit<LudusRequestOptions, "method">) =>
  ludusRequest<T>(path, { ...opts, method: "GET" })

export const ludusPost = <T>(path: string, body?: unknown, opts?: Omit<LudusRequestOptions, "method" | "body">) =>
  ludusRequest<T>(path, { ...opts, method: "POST", body })

export const ludusPut = <T>(path: string, body?: unknown, opts?: Omit<LudusRequestOptions, "method" | "body">) =>
  ludusRequest<T>(path, { ...opts, method: "PUT", body })

export const ludusDelete = <T>(path: string, body?: unknown, opts?: Omit<LudusRequestOptions, "method" | "body">) =>
  ludusRequest<T>(path, { ...opts, method: "DELETE", body })
