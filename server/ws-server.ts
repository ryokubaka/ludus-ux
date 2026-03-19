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
import net from "net"
import fs from "fs"
import { WebSocketServer, WebSocket } from "ws"
import { Client as SSHClient } from "ssh2"
import { getVncSession } from "../src/lib/vnc-token-store"
import { proxmoxCreateVncProxy, proxmoxLogin } from "../src/lib/proxmox-http"

// ── TLS configuration ────────────────────────────────────────────────────────
const tlsCertPath = process.env.TLS_CERT_PATH || "/app/certificates/cert.pem"
const tlsKeyPath  = process.env.TLS_KEY_PATH  || "/app/certificates/key.pem"

let tlsOptions: https.ServerOptions | null = null
if (process.env.DISABLE_HTTPS !== "true" && fs.existsSync(tlsCertPath) && fs.existsSync(tlsKeyPath)) {
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

const MAX_UPSTREAM_RETRIES = 3

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
  let retryCount = 0

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
      retryCount = 0  // reset on successful connect so future drops can retry too
    })

    ws.on("message", (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary })
      }
    })

    ws.on("close", async (code, reason) => {
      if (!opened && retryCount < MAX_UPSTREAM_RETRIES && shouldRetryUpstream(code)) {
        retryCount++
        // Exponential backoff: 300 ms, 600 ms, 1200 ms
        const backoffMs = 300 * Math.pow(2, retryCount - 1)
        console.log(`[VNC upstream] connection failed (code ${code}), retry ${retryCount}/${MAX_UPSTREAM_RETRIES} in ${backoffMs}ms`)
        await new Promise((r) => setTimeout(r, backoffMs))
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
      // Errors (e.g. 401) always precede a close event — log here, let the
      // close handler decide whether to retry or close the client socket.
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

// ── Admin API SSH tunnel ──────────────────────────────────────────────────────
//
// The Ludus admin API (port 8081) typically binds only to 127.0.0.1 on the
// Proxmox host.  A Docker bridge-networked container cannot reach that
// loopback address directly.  We work around this by setting up a local TCP
// server (on ADMIN_TUNNEL_PORT inside the container) that forwards each
// connection through an SSH channel to the remote host's 127.0.0.1:8081.
// The LUDUS_ADMIN_URL env var is then updated so that the settings-store
// (which reads it on every getSettings() call) uses the tunneled address.
//
// A new SSH channel is opened for each TCP connection.  Admin operations are
// infrequent so the per-call SSH overhead is acceptable and avoids having to
// maintain a persistent reconnecting SSH connection.
const ADMIN_TUNNEL_PORT = 18081

function startAdminTunnel(): Promise<void> {
  const sshHost     = (process.env.LUDUS_SSH_HOST       || "").replace(/\r/g, "")
  const sshPort     = parseInt(process.env.LUDUS_SSH_PORT || "22", 10)
  const sshUser     = (process.env.PROXMOX_SSH_USER      || "root").replace(/\r/g, "")
  const sshPassword = (process.env.PROXMOX_SSH_PASSWORD  || "").replace(/\r/g, "")

  if (!sshHost || !sshPassword) {
    console.log("[admin-tunnel] SSH credentials not configured — skipping tunnel")
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    const server = net.createServer((socket) => {
      const conn = new SSHClient()

      conn.on("ready", () => {
        // Ask the remote SSH server to open a channel to its own localhost:8081
        conn.forwardOut("127.0.0.1", ADMIN_TUNNEL_PORT, "127.0.0.1", 8081, (err, stream) => {
          if (err) {
            console.error("[admin-tunnel] forwardOut error:", err.message)
            socket.destroy()
            conn.end()
            return
          }
          socket.pipe(stream)
          stream.pipe(socket)
          socket.on("error", () => { stream.destroy(); conn.end() })
          stream.on("close", () => { socket.destroy(); conn.end() })
        })
      })

      conn.on("error", (err) => {
        console.error("[admin-tunnel] SSH error:", err.message)
        socket.destroy()
      })

      conn.connect({
        host: sshHost,
        port: sshPort,
        username: sshUser,
        password: sshPassword,
        readyTimeout: 10_000,
        authHandler: ["password"],
      })
    })

    server.on("error", (err) => {
      console.error("[admin-tunnel] Server error:", err.message)
      resolve() // Don't block startup; admin ops will fail with a clear error
    })

    server.listen(ADMIN_TUNNEL_PORT, "127.0.0.1", () => {
      // Point the admin URL at our local tunnel endpoint.
      // settings-store.defaults() reads process.env on every getSettings() call,
      // so this change takes effect immediately for all subsequent API calls.
      process.env.LUDUS_ADMIN_URL = `https://127.0.0.1:${ADMIN_TUNNEL_PORT}`
      console.log(`[admin-tunnel] Listening on 127.0.0.1:${ADMIN_TUNNEL_PORT} → ${sshHost}:8081`)
      resolve()
    })
  })
}

// ── Boot Next.js standalone server ───────────────────────────────────────────
;(async () => {
  await startAdminTunnel()
  require("./server")
})()
