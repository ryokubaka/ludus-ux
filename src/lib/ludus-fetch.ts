/**
 * HTTPS to Ludus, PocketBase, and Proxmox.
 * LUDUS_TLS_INSECURE skips certificate checks for those calls only.
 * Other HTTPS (GitHub, Galaxy, git) keeps Node's default verification.
 */

import http from "http"
import https from "https"
import { isLudusTlsInsecure } from "./tls-insecure-env"

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

function insecureRequest(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input.toString())
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
      const req = transport.request(
        url,
        // Reached only when LUDUS_TLS_INSECURE is set (see ludusFetch below).
        // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
        {
          method: init?.method ?? "GET",
          headers,
          rejectUnauthorized: false,
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

/** Fetch Ludus, PocketBase, or Proxmox. Certificate checks follow LUDUS_TLS_INSECURE. */
export function ludusFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  if (!isLudusTlsInsecure()) return fetch(input, init)
  return insecureRequest(input, init)
}
