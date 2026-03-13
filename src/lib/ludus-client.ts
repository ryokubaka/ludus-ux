/**
 * Ludus API client - server-side only, used in Next.js API routes.
 * Settings are read from the runtime settings store (which starts from env vars
 * and can be overridden at runtime via the Settings page).
 *
 * Ludus v2 uses /api/v2 as the base path for all API endpoints.
 */

import { getSettings } from "./settings-store"

export interface LudusRequestOptions {
  method?: string
  body?: unknown
  apiKey?: string
  useAdminEndpoint?: boolean
  userOverride?: string
}

export async function ludusRequest<T = unknown>(
  path: string,
  options: LudusRequestOptions = {}
): Promise<{ data?: T; error?: string; status: number }> {
  const {
    method = "GET",
    body,
    apiKey = "",
    useAdminEndpoint = false,
    userOverride,
  } = options

  const settings = getSettings()
  const baseUrl = useAdminEndpoint && settings.ludusAdminUrl
    ? settings.ludusAdminUrl
    : settings.ludusUrl

  // Build URL — prepend /api/v2 for Ludus v2 API.
  // The root path "/" maps to "/api/v2/" (the version endpoint).
  const cleanBase = baseUrl.replace(/\/$/, "")
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

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
      cache: "no-store",
    }

    if (body !== undefined) {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body)
    }

    const response = await fetch(url, fetchOptions)
    const status = response.status

    if (status === 204) {
      return { status }
    }

    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const data = await response.json()
      if (!response.ok) {
        return { error: data?.error || `HTTP ${status}`, status }
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
    const message = err instanceof Error ? err.message : String(err)
    return { error: `Connection failed: ${message}`, status: 0 }
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
