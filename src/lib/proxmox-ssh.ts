/**
 * SSH helper for running pvesh / curl commands on the Proxmox host.
 * Used by console API routes (SPICE + VNC).
 */
import { Client as SSHClient } from "ssh2"

export function sshExec(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
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
    conn.connect({ host, port, username, password, readyTimeout: 10000 })
  })
}
