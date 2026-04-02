/**
 * SSH-based authentication against the Ludus server.
 * Reads and writes LUDUS_API_KEY from the user's ~/.bashrc.
 */

import { Client as SSHClient, type ConnectConfig } from "ssh2"

const LUDUS_SSH_HOST = process.env.LUDUS_SSH_HOST || process.env.GOAD_SSH_HOST || ""
const LUDUS_SSH_PORT = parseInt(process.env.LUDUS_SSH_PORT || process.env.GOAD_SSH_PORT || "22", 10)

// Pattern to find LUDUS_API_KEY in .bashrc
// Matches: export LUDUS_API_KEY=xxx  OR  LUDUS_API_KEY=xxx  (with or without quotes)
const API_KEY_PATTERN = /(?:export\s+)?LUDUS_API_KEY=['"]?([^'"\s\n]+)['"]?/

export type AuthResult =
  | { success: true; apiKey: string }
  | { success: false; reason: "no_api_key" }  // connected but no key in .bashrc
  | { success: false; reason: "auth_failed"; message: string }
  | { success: false; reason: "connection_failed"; message: string }

/**
 * Attempt to SSH into the Ludus server as `username` using `password`.
 * On success, reads LUDUS_API_KEY from ~/.bashrc and returns it.
 */
export async function authenticateUser(
  username: string,
  password: string
): Promise<AuthResult> {
  if (!LUDUS_SSH_HOST) {
    return {
      success: false,
      reason: "connection_failed",
      message: "LUDUS_SSH_HOST is not configured. Set it in your .env file.",
    }
  }

  const config: ConnectConfig = {
    host: LUDUS_SSH_HOST,
    port: LUDUS_SSH_PORT,
    username,
    password,
    readyTimeout: 10000,
    // Don't try agent/key auth — we're doing password auth for the login flow
    authHandler: ["password"],
  }

  return new Promise((resolve) => {
    const conn = new SSHClient()

    conn.on("ready", () => {
      // Read ~/.bashrc for the API key
      conn.exec("cat ~/.bashrc 2>/dev/null || true", (err, stream) => {
        if (err) {
          conn.end()
          return resolve({
            success: false,
            reason: "connection_failed",
            message: err.message,
          })
        }

        let output = ""
        stream.on("data", (data: Buffer) => { output += data.toString() })
        stream.stderr.on("data", () => {}) // ignore stderr
        stream.on("close", () => {
          conn.end()
          const match = output.match(API_KEY_PATTERN)
          if (match?.[1]) {
            resolve({ success: true, apiKey: match[1] })
          } else {
            resolve({ success: false, reason: "no_api_key" })
          }
        })
      })
    })

    conn.on("error", (err) => {
      const msg = err.message || String(err)
      const isAuthFail =
        msg.includes("Authentication") ||
        msg.includes("credentials") ||
        msg.includes("permission denied") ||
        msg.toLowerCase().includes("auth")

      // If DNS resolution fails, give the user a concrete fix.
      const isDnsFail =
        msg.includes("ENOTFOUND") ||
        msg.includes("getaddrinfo") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ENETUNREACH")
      const hint = isDnsFail
        ? ` Cannot resolve "${LUDUS_SSH_HOST}" inside the container. Add LUDUS_SERVER_IP=<server-ip> to your .env — the container will inject the hosts entry automatically on next restart.`
        : ""

      resolve({
        success: false,
        reason: isAuthFail ? "auth_failed" : "connection_failed",
        message: msg + hint,
      })
    })

    conn.connect(config)
  })
}

/**
 * Write (or update) LUDUS_API_KEY in the user's ~/.bashrc on the Ludus server.
 * Uses SSH with password credentials obtained at login time.
 */
export async function saveApiKeyToBashrc(
  username: string,
  password: string,
  apiKey: string
): Promise<{ success: boolean; message?: string }> {
  if (!LUDUS_SSH_HOST) {
    return { success: false, message: "LUDUS_SSH_HOST is not configured." }
  }

  // Shell command: remove any existing LUDUS_API_KEY / LUDUS_VERSION lines then
  // append fresh exports for both. LUDUS_VERSION=2 is required for Ludus v2.
  const command = [
    `sed -i '/\\(export \\)\\?LUDUS_API_KEY=/d' ~/.bashrc`,
    `sed -i '/\\(export \\)\\?LUDUS_VERSION=/d' ~/.bashrc`,
    `echo 'export LUDUS_API_KEY=${apiKey}' >> ~/.bashrc`,
    `echo 'export LUDUS_VERSION=2' >> ~/.bashrc`,
  ].join(" && ")

  return new Promise((resolve) => {
    const conn = new SSHClient()

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end()
          return resolve({ success: false, message: err.message })
        }

        let stderr = ""
        stream.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
        stream.on("close", (code: number) => {
          conn.end()
          if (code === 0) {
            resolve({ success: true })
          } else {
            resolve({ success: false, message: stderr || `Exit code ${code}` })
          }
        })
      })
    })

    conn.on("error", (err) => {
      resolve({ success: false, message: err.message })
    })

    conn.connect({
      host: LUDUS_SSH_HOST,
      port: LUDUS_SSH_PORT,
      username,
      password,
      readyTimeout: 10000,
      authHandler: ["password"],
    })
  })
}
