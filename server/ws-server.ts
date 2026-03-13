/**
 * Custom Next.js entry-point with WebSocket proxy support.
 *
 * Key discovery: Node.js does NOT fire 'request' for WebSocket upgrade requests
 * when there is an 'upgrade' listener. Only 'upgrade' fires.
 * Next.js's startServer() calls http.createServer(requestListener) AND THEN
 * calls server.on('upgrade', nextJsUpgradeHandler). When our 'upgrade' handler
 * takes over the socket, Next.js's upgrade handler ALSO runs and writes
 * "Internal Server Error" onto the socket, corrupting the WebSocket stream.
 *
 * Fix: intercept server.on() calls to wrap Next.js's upgrade listener so it
 * skips /api/vnc-ws requests. All other paths pass through normally.
 */

// Disable TLS verification for the Proxmox self-signed cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

import http from "http"
import https from "https"
import fs from "fs"
import { WebSocketServer, WebSocket } from "ws"
import { getVncSession } from "../src/lib/vnc-token-store"
import { proxmoxCreateVncProxy, proxmoxLogin } from "../src/lib/proxmox-http"

// ── TLS configuration ────────────────────────────────────────────────────────
const tlsCertPath = process.env.TLS_CERT_PATH || "/app/certificates/cert.pem"
const tlsKeyPath  = process.env.TLS_KEY_PATH  || "/app/certificates/key.pem"

let tlsOptions: https.ServerOptions | null = null
if (fs.existsSync(tlsCertPath) && fs.existsSync(tlsKeyPath)) {
  try {
    tlsOptions = {
      cert: fs.readFileSync(tlsCertPath),
      key:  fs.readFileSync(tlsKeyPath),
    }
    console.log(`[tls] HTTPS enabled — cert: ${tlsCertPath}, key: ${tlsKeyPath}`)
  } catch (err) {
    console.error(`[tls] Failed to read TLS files, falling back to HTTP:`, (err as Error).message)
  }
} else {
  console.log("[tls] No TLS certificate found, running HTTP only")
}

// ── Monkey-patch http.createServer ────────────────────────────────────────────
// When TLS certs are available, transparently swap in https.createServer so
// the Next.js standalone server serves HTTPS without any code changes.
const _origCreate = http.createServer.bind(http)

// @ts-ignore
http.createServer = function patchedCreateServer(
  optsOrListener?: http.ServerOptions | http.RequestListener,
  listener?: http.RequestListener,
) {
  let server: http.Server

  if (tlsOptions) {
    if (typeof optsOrListener === "function") {
      server = https.createServer(tlsOptions, optsOrListener) as unknown as http.Server
    } else {
      server = https.createServer(
        { ...tlsOptions, ...(optsOrListener as object) },
        listener!,
      ) as unknown as http.Server
    }
  } else {
    server = (typeof optsOrListener === "function")
      ? _origCreate(optsOrListener)
      : _origCreate(optsOrListener as http.ServerOptions, listener!)
  }

  const wss = new WebSocketServer({ noServer: true })

  // ── Our VNC upgrade handler (registered first) ────────────────────────────
  server.on("upgrade", (req, socket, head) => {
    const rawUrl = req.url || ""
    const pathname = rawUrl.split("?")[0]

    if (pathname === "/api/vnc-ws") {
      const qs = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1) : ""
      const token = new URLSearchParams(qs).get("token") || ""
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        handleVncProxy(clientWs, token)
      })
    } else {
      socket.destroy()
    }
  })

  // ── Wrap future server.on('upgrade', ...) calls ───────────────────────────
  // Next.js's startServer() calls server.on('upgrade', nextJsHandler) AFTER
  // we've returned the server. Wrap those calls to skip /api/vnc-ws so
  // Next.js's handler doesn't write onto a socket we've already upgraded.
  const _origOn = server.on.bind(server)
  const _origAddListener = server.addListener.bind(server)

  function wrapUpgradeListener(
    fn: (req: http.IncomingMessage, socket: import("net").Socket, head: Buffer) => void,
  ) {
    return function wrappedUpgrade(
      req: http.IncomingMessage,
      socket: import("net").Socket,
      head: Buffer,
    ) {
      if ((req.url || "").split("?")[0] === "/api/vnc-ws") {
        return // already handled by our VNC handler above
      }
      return fn(req, socket, head)
    }
  }

  // @ts-ignore
  server.on = function on(event: string, listener: (...args: unknown[]) => void) {
    if (event === "upgrade") {
      return _origOn(event, wrapUpgradeListener(listener as Parameters<typeof wrapUpgradeListener>[0]))
    }
    return _origOn(event, listener)
  }
  // @ts-ignore
  server.addListener = server.on

  return server
}

// ── VNC WebSocket proxy ────────────────────────────────────────────────────────
function shouldRetryUpstream(code: number): boolean {
  // 1006 is the common "abnormal closure" seen when auth/ticket timing is off.
  return code === 1006 || code === 1002 || code === 1011
}

async function refreshUpstreamSession(session: {
  pveHost: string
  pveUser?: string
  pvePassword?: string
  node?: string
  vmid?: string
}) {
  if (!session.pveUser || !session.pvePassword || !session.node || !session.vmid) {
    return null
  }

  const auth = await proxmoxLogin(session.pveHost, session.pveUser, session.pvePassword)
  const vnc = await proxmoxCreateVncProxy(session.pveHost, auth, session.node, session.vmid)
  return {
    ...session,
    pveAuthCookie: auth.cookie,
    wsPath: vnc.wsPath,
    port: vnc.port,
    vncticket: vnc.ticket,
  }
}

function handleVncProxy(clientWs: WebSocket, token: string) {
  if (!token) {
    clientWs.close(4001, "No token provided")
    return
  }

  const session = getVncSession(token)
  if (!session) {
    clientWs.close(4001, "Invalid or expired session token")
    return
  }

  let currentSession = session
  let upstreamWs: WebSocket | null = null
  let retried = false

  const connectUpstream = (targetSession: typeof currentSession) => {
    const upstreamUrl =
      `wss://${targetSession.pveHost}:8006${targetSession.wsPath}?port=${targetSession.port}&vncticket=${encodeURIComponent(targetSession.vncticket)}`
    const ws = new WebSocket(upstreamUrl, {
      headers: { Cookie: `PVEAuthCookie=${targetSession.pveAuthCookie}` },
      rejectUnauthorized: false,
    })
    upstreamWs = ws

    let opened = false
    ws.on("open", () => {
      opened = true
    })

    ws.on("message", (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary })
      }
    })

    ws.on("close", async (code, reason) => {
      if (!opened && !retried && shouldRetryUpstream(code)) {
        retried = true
        try {
          const refreshed = await refreshUpstreamSession(currentSession)
          if (refreshed) {
            currentSession = refreshed
            connectUpstream(currentSession)
            return
          }
        } catch (err) {
          console.error("[VNC upstream refresh error]", (err as Error).message)
        }
      }
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason)
    })

    ws.on("error", (err) => {
      console.error("[VNC upstream error]", err.message)
    })
  }

  clientWs.on("message", (data, isBinary) => {
    if (upstreamWs?.readyState === WebSocket.OPEN) {
      upstreamWs.send(data, { binary: isBinary })
    }
  })

  connectUpstream(currentSession)

  clientWs.on("close", () => {
    if (upstreamWs && upstreamWs.readyState < 2) upstreamWs.close()
  })

  clientWs.on("error", (err) => {
    console.error("[VNC client error]", err.message)
  })
}

// ── Boot Next.js standalone server ───────────────────────────────────────────
require("./server")
