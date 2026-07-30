#!/usr/bin/env node
/**
 * Live check: root SSH + ~/.bashrc LUDUS_API_KEY read (same path as impersonation).
 * Self-contained — runs in production container without TS sources.
 *
 *   docker compose exec ludus-ux node scripts/verify-impersonation-ssh.mjs testuser adminuser
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client as SSHClient } from "ssh2"
import Database from "better-sqlite3"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const DATA_DIR = process.env.DATA_DIR || path.join(root, "data")

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function parseLudusApiKeyFromBashrcLine(line) {
  const trimmed = line.trim()
  const eq = trimmed.indexOf("=")
  if (eq < 0) return ""
  let value = trimmed.slice(eq + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  return value.trim()
}

function readPrivateKey(keyPath) {
  const candidates = [
    keyPath?.trim(),
    process.env.PROXMOX_SSH_KEY_PATH?.trim(),
    process.env.GOAD_SSH_KEY_PATH?.trim(),
    "/app/ssh/id_rsa",
    "/app/ssh/id_ed25519",
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      const buf = fs.readFileSync(p)
      const s = buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      return { key: Buffer.from(s, "utf8"), path: p }
    } catch {
      /* try next */
    }
  }
  return null
}

function loadSettings() {
  const defaults = {
    sshHost: process.env.LUDUS_SSH_HOST || process.env.GOAD_SSH_HOST || "",
    sshPort: parseInt(process.env.LUDUS_SSH_PORT || process.env.GOAD_SSH_PORT || "22", 10),
    proxmoxSshUser: process.env.PROXMOX_SSH_USER || "root",
    proxmoxSshPassword: process.env.PROXMOX_SSH_PASSWORD || "",
    proxmoxSshKeyPath: "",
  }
  try {
    const db = new Database(path.join(DATA_DIR, "ludus-ux.db"), { readonly: true })
    const rows = db.prepare("SELECT key, value FROM settings").all()
    for (const { key, value } of rows) {
      if (key === "sshHost") defaults.sshHost = value
      if (key === "sshPort") defaults.sshPort = parseInt(value, 10) || defaults.sshPort
      if (key === "proxmoxSshUser") defaults.proxmoxSshUser = value
      if (key === "proxmoxSshPassword") defaults.proxmoxSshPassword = value
      if (key === "proxmoxSshKeyPath") defaults.proxmoxSshKeyPath = value
    }
    db.close()
  } catch (e) {
    console.warn("SQLite settings unavailable:", e instanceof Error ? e.message : e)
  }
  return defaults
}

function sshExec(host, port, username, password, command, privateKey) {
  return new Promise((resolve, reject) => {
    const base = { host, port, username, readyTimeout: 10000 }
    const cfg = password?.trim()
      ? { ...base, password: password.trim() }
      : { ...base, privateKey }
    const conn = new SSHClient()
    conn.on("ready", () => {
      conn.exec(`bash -l -c ${JSON.stringify(command)}`, (err, stream) => {
        if (err) {
          conn.end()
          return reject(err)
        }
        let out = ""
        let errOut = ""
        stream.on("data", (d) => {
          out += d.toString()
        })
        stream.stderr.on("data", (d) => {
          errOut += d.toString()
        })
        stream.on("close", (code) => {
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

async function readUserApiKeyFromBashrc(username, settings, privateKey) {
  const linuxUser = username.trim().toLowerCase()
  const host = settings.sshHost.trim()
  const port = settings.sshPort || 22
  const sshUser = settings.proxmoxSshUser || "root"
  const sshPw = settings.proxmoxSshPassword || ""

  let homeDir = `/home/${linuxUser}`
  try {
    const home = (
      await sshExec(
        host,
        port,
        sshUser,
        sshPw,
        `getent passwd ${shellQuote(linuxUser)} 2>/dev/null | cut -d: -f6`,
        privateKey,
      )
    ).trim()
    if (home) homeDir = home
  } catch {
    /* default home */
  }

  const bashrc = shellQuote(`${homeDir}/.bashrc`)
  const profile = shellQuote(`${homeDir}/.profile`)
  const extractCmd =
    `(grep -E '(export[[:space:]]+)?LUDUS_API_KEY=' ${bashrc} 2>/dev/null; ` +
    `grep -E '(export[[:space:]]+)?LUDUS_API_KEY=' ${profile} 2>/dev/null) | tail -1; true`

  const line = await sshExec(host, port, sshUser, sshPw, extractCmd, privateKey)
  const apiKey = parseLudusApiKeyFromBashrcLine(line)
  return apiKey || null
}

const users = process.argv.slice(2)
if (users.length === 0) {
  console.error("Usage: node scripts/verify-impersonation-ssh.mjs <linux-user> [...]")
  process.exit(2)
}

const settings = loadSettings()
const keyMat = readPrivateKey(settings.proxmoxSshKeyPath)
if (!settings.sshHost?.trim()) {
  console.error("FAIL: sshHost not configured")
  process.exit(1)
}
if (!settings.proxmoxSshPassword?.trim() && !keyMat) {
  console.error("FAIL: no SSH password or private key")
  process.exit(1)
}

console.log(`sshHost=${settings.sshHost} key=${keyMat?.path ?? "password"}`)

let failed = 0
for (const u of users) {
  try {
    const apiKey = await readUserApiKeyFromBashrc(u, settings, keyMat.key)
    if (apiKey) {
      console.log(`OK ${u}: ${apiKey.slice(0, 12)}…${apiKey.slice(-4)} (${apiKey.length} chars)`)
    } else {
      console.error(`FAIL ${u}: key not found in ~/.bashrc`)
      failed++
    }
  } catch (e) {
    console.error(`FAIL ${u}:`, e instanceof Error ? e.message : e)
    failed++
  }
}

process.exit(failed > 0 ? 1 : 0)
