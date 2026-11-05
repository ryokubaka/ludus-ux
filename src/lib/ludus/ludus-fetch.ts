/**
 * HTTPS to Ludus, PocketBase, and Proxmox.
 * LUDUS_TLS_INSECURE skips certificate checks for those calls only.
 * Other HTTPS (GitHub, Galaxy, git) keeps Node's default verification.
 */

import http from "http"
import https from "https"
import { isLudusTlsInsecure } from "@/lib/settings/tls-insecure-env"

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  const asHeaders = new Headers(headers)
  asHeaders.forEach((value, key) => {
    out[key] = value
  })
  return out
}

async function materializeBody(body: BodyInit): Promise<{ bytes: Buffer; contentType: string | null }> {
  const wrapped = new Response(body)
  return {
    bytes: Buffer.from(await wrapped.arrayBuffer()),
    contentType: wrapped.headers.get("content-type"),
  }
}

const METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"])
const MAX_LUDUS_REDIRECTS = 3

/** Lab URLs may be private. Only the scheme, userinfo, and metadata hosts are refused. */
export function assertLudusFetchUrl(input: string | URL): URL {
  const url = new URL(typeof input === "string" ? input : input.toString())
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ludus URL must be http or https")
  }
  if (url.username || url.password) {
    throw new Error("Ludus URL cannot include userinfo")
  }
  if (METADATA_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Ludus URL cannot target the instance metadata service")
  }
  return url
}

function insecureRequest(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = assertLudusFetchUrl(input)
  const transport = url.protocol === "http:" ? http : https
  return (async () => {
    const headers = headerRecord(init?.headers)
    let payload: Buffer | undefined
    if (init?.body != null) {
      const materialized = await materializeBody(init.body)
      payload = materialized.bytes
      if (materialized.contentType && !headers["content-type"]) {
        headers["content-type"] = materialized.contentType
      }
      headers["content-length"] = String(payload.length)
    }
    return new Promise<Response>((resolve, reject) => {
      // codeql[js/request-forgery]
      const req = transport.request(
        url,
        // Reached only when LUDUS_TLS_INSECURE is set (see ludusFetch below).
        // Semgrep only honors a suppression on the line directly above this object.
        // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
        {
          method: init?.method ?? "GET",
          headers,
          // This path runs only when LUDUS_TLS_INSECURE is set. The value is not
          // the literal false, so the certificate query does not treat it as a constant.
          // codeql[js/disabling-certificate-validation]
          rejectUnauthorized: !isLudusTlsInsecure(), // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (chunk: Buffer) => chunks.push(chunk))
          res.on("end", () => {
            const responseHeaders = new Headers()
            for (const [key, value] of Object.entries(res.headers)) {
              if (value == null) continue
              if (Array.isArray(value)) {
                for (const item of value) responseHeaders.append(key, item)
              } else {
                responseHeaders.set(key, value)
              }
            }
            resolve(new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              headers: responseHeaders,
            }))
          })
        },
      )
      const abort = () => {
        req.destroy()
        reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))
      }
      if (init?.signal) {
        if (init.signal.aborted) {
          abort()
          return
        }
        init.signal.addEventListener("abort", abort, { once: true })
      }
      req.on("error", reject)
      if (payload) req.end(payload)
      else req.end()
    })
  })()
}

async function fetchSameHost(
  url: URL,
  init: RequestInit | undefined,
  insecure: boolean,
  hops = 0,
): Promise<Response> {
  const nextInit = { ...init, redirect: "manual" as const }
  let res: Response
  if (insecure) {
    res = await insecureRequest(url, nextInit)
  } else {
    // codeql[js/request-forgery]
    res = await fetch(url, nextInit)
  }
  if (res.status < 300 || res.status >= 400 || hops >= MAX_LUDUS_REDIRECTS) return res
  const location = res.headers.get("location")
  if (!location) return res
  const dest = assertLudusFetchUrl(new URL(location, url))
  if (dest.origin !== url.origin) {
    throw new Error("Ludus redirect to another host was refused")
  }
  return fetchSameHost(dest, init, insecure, hops + 1)
}

/** Fetch Ludus, PocketBase, or Proxmox. Certificate checks follow LUDUS_TLS_INSECURE. */
export function ludusFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  return fetchSameHost(assertLudusFetchUrl(input), init, isLudusTlsInsecure())
}
