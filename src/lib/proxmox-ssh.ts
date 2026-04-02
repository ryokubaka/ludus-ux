/**
 * SSH helper for running pvesh / curl commands on the Proxmox host.
 * Used by console API routes (SPICE + VNC).
 *
 * When `password` is empty, authenticates with a private key (same resolution
 * as GOAD / admin tunnel: PROXMOX_SSH_KEY_PATH, GOAD_SSH_KEY_PATH, /app/ssh/*).
 */
import { Client as SSHClient, type ConnectConfig } from "ssh2"
import { readPrivateKey, getSshKeyPassphrase } from "./root-ssh-auth"

function buildSshConnectConfig(
  host: string,
  port: number,
  username: string,
  password: string,
): ConnectConfig {
  const pw = password?.trim()
  const base: ConnectConfig = { host, port, username, readyTimeout: 10000 }
  if (pw) {
    return { ...base, password: pw }
  }
  const key = readPrivateKey()
  if (!key) {
    throw new Error(
      "SSH authentication failed: no password and no readable private key (mount ./ssh or set PROXMOX_SSH_KEY_PATH).",
    )
  }
  const ph = getSshKeyPassphrase()
  return { ...base, privateKey: key, ...(ph ? { passphrase: ph } : {}) }
}

export function sshExec(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let cfg: ConnectConfig
    try {
      cfg = buildSshConnectConfig(host, port, username, password)
    } catch (e) {
      return reject(e)
    }
    const conn = new SSHClient()
    conn.on("ready", () => {
      // Use bash -l (login shell) so /etc/profile is sourced and Proxmox tools
      // like pvesh are on PATH regardless of their exact install location.
      conn.exec(`bash -l -c ${JSON.stringify(command)}`, (err, stream) => {
        if (err) { conn.end(); return reject(err) }
        let out = "", errOut = ""
        stream.on("data", (d: Buffer) => { out += d.toString() })
        stream.stderr.on("data", (d: Buffer) => { errOut += d.toString() })
        stream.on("close", (code: number) => {
          conn.end()
          if (code !== 0) reject(new Error(errOut.trim() || `Exit code ${code}`))
          else resolve(out.trim())
        })
      })
    })
    conn.on("error", reject)
    conn.connect(cfg)
  })
}
