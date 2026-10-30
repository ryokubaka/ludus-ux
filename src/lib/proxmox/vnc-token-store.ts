/**
 * Short-lived in-memory store for VNC proxy sessions.
 *
 * The store is keyed on global.__vncTokenStore so it is shared between:
 *  - the custom WS server (ws-server.js, compiled by esbuild and inlined here)
 *  - the Next.js API route handlers (compiled separately by Next.js)
 * Both run in the same Node.js process so the global object is truly shared.
 */

import { randomUUID } from "crypto"

export interface VncSession {
  /** LUX session owner — token is bound to this user */
  username: string
  pveHost: string
  wsPath: string
  port: string
  vncticket: string
  /** PVEAuthCookie value — authenticates the upstream Proxmox WebSocket */
  pveAuthCookie: string
  /** Proxmox auth user for refresh/re-auth (e.g. root or root@pam) */
  pveUser?: string
  /** Proxmox auth password for refresh/re-auth */
  pvePassword?: string
  /** Node/vmid used to refresh websocket ticket when needed */
  node?: string
  vmid?: string
}

interface StoredSession extends VncSession {
  expires: number
  consumed: boolean
}

// Attach to global so both esbuild-bundled server and Next.js route bundles
// access the same Map instance within the process.
const g = global as typeof global & { __vncTokenStore?: Map<string, StoredSession> }
if (!g.__vncTokenStore) {
  g.__vncTokenStore = new Map()
}
const store = g.__vncTokenStore

const TTL_MS = 120_000 // 2 minutes — enough for slow connections

// Periodic cleanup — unref so it doesn't keep the process alive
const timer = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of store) {
    if (v.expires < now) store.delete(k)
  }
}, 30_000)
if (typeof timer.unref === "function") timer.unref()

export function storeVncSession(session: VncSession): string {
  const token = randomUUID()
  store.set(token, { ...session, expires: Date.now() + TTL_MS, consumed: false })
  return token
}


export function consumeVncSession(token: string): VncSession | null {
  const s = store.get(token)
  if (!s) return null
  if (s.consumed || s.expires < Date.now()) {
    store.delete(token)
    return null
  }
  s.consumed = true
  store.delete(token)
  const { expires: _e, consumed: _c, ...session } = s
  return session
}

/** @deprecated Prefer consumeVncSession for one-time use */
export function getVncSession(token: string): VncSession | null {
  const s = store.get(token)
  if (!s) return null
  if (s.expires < Date.now()) {
    store.delete(token)
    return null
  }
  return s
}
