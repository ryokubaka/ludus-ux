/**
 * Validates user-supplied GitLab HTTP API base URLs for template listing/fetch.
 * Mitigates SSRF: only https, block loopback/link-local/private/reserved addresses
 * after DNS resolution, and do not follow redirects to a different unchecked host.
 */

import { lookup as dnsLookup } from "dns/promises"
import https from "https"
import net from "net"
import type { Readable } from "stream"

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

const MAX_REPO_REDIRECTS = 3

export type RepoLookup = (hostname: string) => Promise<Array<{ address: string }>>

export type RepoPinnedRequest = (target: URL, address: string, init?: RequestInit) => Promise<Response>

export function isBlockedIpAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map((part) => Number(part))
    if (parts.some((part) => Number.isNaN(part))) return true
    return isPrivateOrReservedIpv4(parts)
  }
  if (net.isIP(address) === 6) {
    const lower = address.toLowerCase()
    if (lower === "::1" || lower === "::") return true
    if (lower.startsWith("fe80:")) return true
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isBlockedIpAddress(mapped[1])
    return false
  }
  return true
}

async function defaultRepoLookup(hostname: string): Promise<Array<{ address: string }>> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true })
  return records.map((record) => ({ address: record.address }))
}

/** Resolve the name and reject every private, loopback, or link-local address. */
export async function assertResolvedRepoHost(hostname: string, resolve: RepoLookup = defaultRepoLookup): Promise<string> {
  const literal = hostname.replace(/^\[|\]$/g, "")
  if (net.isIP(literal)) {
    if (isBlockedIpAddress(literal)) throw new Error("Private or reserved addresses are not allowed")
    return literal
  }
  let records: Array<{ address: string }>
  try {
    records = await resolve(hostname)
  } catch {
    throw new Error("Hostname did not resolve")
  }
  if (records.length === 0) throw new Error("Hostname did not resolve")
  for (const record of records) {
    if (isBlockedIpAddress(record.address)) {
      throw new Error("Hostname resolves to a private or reserved address")
    }
  }
  return records[0].address
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(headers).forEach((value, key) => {
    out[key] = value
  })
  return out
}

export const REPO_REQUEST_TIMEOUT_MS = 30_000
/** Repo tree and contents listings are small; a larger body is not a listing. */
export const REPO_RESPONSE_MAX_BYTES = 10 * 1024 * 1024

/** Collect a response body, failing once it passes `maxBytes`. */
export function readCappedBody(body: Readable, maxBytes: number): Promise<Buffer<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    body.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        body.destroy()
        reject(new Error(`Template repo response is larger than ${maxBytes} bytes`))
        return
      }
      chunks.push(chunk)
    })
    body.on("end", () => resolve(Buffer.concat(chunks)))
    body.on("error", reject)
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError")
}

export function pinnedRepoRequest(
  target: URL,
  address: string,
  init?: RequestInit,
  limits: { timeoutMs: number; maxBytes: number } = {
    timeoutMs: REPO_REQUEST_TIMEOUT_MS,
    maxBytes: REPO_RESPONSE_MAX_BYTES,
  },
): Promise<Response> {
  const signal = init?.signal ?? undefined
  if (signal?.aborted) return Promise.reject(abortError(signal))
  const headers = headerRecord(init?.headers)
  headers.host = target.host
  const port = target.port ? Number(target.port) : 443
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => fail(abortError(signal!))
    const finish = () => {
      settled = true
      signal?.removeEventListener("abort", onAbort)
    }
    const fail = (err: Error) => {
      if (settled) return
      finish()
      req.destroy()
      reject(err)
    }
    const req = https.request(
      {
        host: address,
        servername: target.hostname,
        port,
        path: `${target.pathname}${target.search}`,
        method: init?.method ?? "GET",
        headers,
      },
      (res) => {
        readCappedBody(res, limits.maxBytes).then(
          (body) => {
            if (settled) return
            finish()
            const responseHeaders = new Headers()
            for (const [key, value] of Object.entries(res.headers)) {
              if (value == null) continue
              if (Array.isArray(value)) {
                for (const item of value) responseHeaders.append(key, item)
              } else {
                responseHeaders.set(key, value)
              }
            }
            resolve(new Response(body, {
              status: res.statusCode ?? 0,
              headers: responseHeaders,
            }))
          },
          fail,
        )
      },
    )
    req.setTimeout(limits.timeoutMs, () => fail(new Error("Template repo request timed out")))
    signal?.addEventListener("abort", onAbort, { once: true })
    req.on("error", fail)
    req.end()
  })
}

export interface SafeRepoFetchDeps {
  lookup?: RepoLookup
  request?: RepoPinnedRequest
}

/** Fetch a template repo URL after checking every resolved address. Redirects are manual. */
export async function safeRepoFetch(
  url: string,
  init?: RequestInit,
  deps?: SafeRepoFetchDeps,
  hops = 0,
): Promise<Response> {
  if (hops > MAX_REPO_REDIRECTS) throw new Error("Too many redirects")
  const checked = assertSafeTemplateRepoUrl(url)
  if (!checked.ok) throw new Error(checked.error)
  const target = new URL(url)
  const address = await assertResolvedRepoHost(target.hostname, deps?.lookup)
  const request = deps?.request ?? pinnedRepoRequest
  const response = await request(target, address, init)
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location")
    if (!location) return response
    const nextUrl = new URL(location, target).toString()
    return safeRepoFetch(nextUrl, init, deps, hops + 1)
  }
  return response
}
