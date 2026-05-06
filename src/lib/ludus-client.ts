/**
 * Ludus API client - server-side only, used in Next.js API routes.
 * Settings are read from the runtime settings store (which starts from env vars
 * and can be overridden at runtime via the Settings page).
 *
 * Ludus v2 uses /api/v2 as the base path for all API endpoints.
 */

import { getSettings } from "./settings-store"

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
    const admin = settings.ludusAdminUrl?.trim()
    if (admin) {
      baseUrl = admin
    } else {
      baseUrl = settings.ludusUrl.replace(/:8080\b/, ":8081").trim()
    }
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
    if (timeoutId) clearTimeout(timeoutId)
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "Connection timed out after 30 s — is the Ludus server reachable?", status: 0 }
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
