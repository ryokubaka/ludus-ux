import { createHash } from "crypto"
import type { ConnectConfig } from "ssh2"
import { getDb } from "./db"

export function sshHostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64")}`
}

/** ssh-keygen prints SHA256 fingerprints without base64 padding. */
function normalizeFingerprint(fingerprint: string): string {
  const text = fingerprint.trim()
  const body = /^sha256:/i.test(text) ? text.slice("SHA256:".length) : text
  return `SHA256:${body.replace(/=+$/, "")}`
}

function blobKeyType(blob: Buffer): string | null {
  if (blob.length < 4) return null
  const len = blob.readUInt32BE(0)
  if (len === 0 || 4 + len > blob.length) return null
  return blob.subarray(4, 4 + len).toString("latin1")
}

export type HostKeyPin =
  | { kind: "fingerprint"; fingerprint: string }
  | { kind: "key"; blob: Buffer }
  | { kind: "invalid" }

/**
 * Accepts `SHA256:...` (padded or not), a public key line `type base64 [comment]`,
 * or a known_hosts line `host type base64`.
 */
export function parseHostKeyPin(pin: string): HostKeyPin {
  const text = pin.trim()
  if (/^sha256:/i.test(text)) return { kind: "fingerprint", fingerprint: normalizeFingerprint(text) }
  const fields = text.split(/\s+/)
  for (let i = 0; i < fields.length - 1; i++) {
    const type = fields[i]
    const encoded = fields[i + 1]
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) continue
    const blob = Buffer.from(encoded, "base64")
    if (blobKeyType(blob) === type) return { kind: "key", blob }
  }
  return { kind: "invalid" }
}

function pinMatches(pin: HostKeyPin, key: Buffer, fingerprint: string): boolean {
  switch (pin.kind) {
    case "fingerprint":
      return pin.fingerprint === normalizeFingerprint(fingerprint)
    case "key":
      return pin.blob.equals(key)
    case "invalid":
      return false
    default: {
      const unreachable: never = pin
      return unreachable
    }
  }
}

let warnedInvalidPin = false

/**
 * Decide whether an SSH host key is acceptable.
 * A configured pin must match. Otherwise the first key is remembered (TOFU)
 * and a later different key is rejected.
 */
export function evaluateSshHostKey(
  key: Buffer,
  storedFingerprint: string | null,
  pinned: string | undefined,
): { accept: boolean; fingerprint: string } {
  const fingerprint = sshHostKeyFingerprint(key)
  const pinText = pinned?.trim()
  if (pinText) {
    const pin = parseHostKeyPin(pinText)
    if (pin.kind === "invalid" && !warnedInvalidPin) {
      warnedInvalidPin = true
      console.error(
        "[ssh-host-key] LUX_SSH_HOST_KEY is neither a SHA256: fingerprint nor a public key line. Every SSH connection is refused.",
      )
    }
    return { accept: pinMatches(pin, key, fingerprint), fingerprint }
  }
  if (!storedFingerprint) return { accept: true, fingerprint }
  return { accept: normalizeFingerprint(storedFingerprint) === normalizeFingerprint(fingerprint), fingerprint }
}

type HostKeyStore = {
  get(host: string, port: number): string | null
  put(host: string, port: number, fingerprint: string): void
  remove(host: string, port: number): boolean
}

let tableReady = false

function hostKeyDb() {
  const db = getDb()
  if (!tableReady) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ssh_host_keys (
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        PRIMARY KEY (host, port)
      )
    `)
    tableReady = true
  }
  return db
}

function sqliteStore(): HostKeyStore {
  return {
    get(host, port) {
      const row = hostKeyDb()
        .prepare("SELECT fingerprint FROM ssh_host_keys WHERE host = ? AND port = ?")
        .get(host, port) as { fingerprint: string } | undefined
      return row?.fingerprint ?? null
    },
    put(host, port, fingerprint) {
      hostKeyDb().prepare(
        "INSERT INTO ssh_host_keys (host, port, fingerprint) VALUES (?, ?, ?) ON CONFLICT(host, port) DO NOTHING",
      ).run(host, port, fingerprint)
    },
    remove(host, port) {
      return hostKeyDb().prepare("DELETE FROM ssh_host_keys WHERE host = ? AND port = ?").run(host, port).changes > 0
    },
  }
}

export type StoredSshHostKey = { host: string; port: number; fingerprint: string }

export function listStoredSshHostKeys(): StoredSshHostKey[] {
  return hostKeyDb()
    .prepare("SELECT host, port, fingerprint FROM ssh_host_keys ORDER BY host, port")
    .all() as StoredSshHostKey[]
}

/** Drop the remembered key so the next connection to host:port pins again. */
export function forgetSshHostKey(host: string, port: number, store: HostKeyStore = sqliteStore()): boolean {
  rejections.delete(`${host}:${port}`)
  return store.remove(host, port)
}

type Rejection = { expected: string; presented: string; at: number }
const rejections = new Map<string, Rejection>()
const REJECTION_TTL_MS = 60_000

export function verifySshHostKey(
  host: string,
  port: number,
  key: Buffer,
  store: HostKeyStore = sqliteStore(),
): boolean {
  const stored = store.get(host, port)
  const pinned = process.env.LUX_SSH_HOST_KEY?.trim()
  const decision = evaluateSshHostKey(key, stored, pinned)
  if (!decision.accept) {
    rejections.set(`${host}:${port}`, {
      expected: pinned ? "LUX_SSH_HOST_KEY" : stored ?? "",
      presented: decision.fingerprint,
      at: Date.now(),
    })
    return false
  }
  if (!stored && !pinned) {
    store.put(host, port, decision.fingerprint)
  }
  return true
}

/**
 * ssh2 reports a refused host key as "Host denied (verification failed)".
 * Name the host and both fingerprints so an admin knows what changed.
 */
export function explainSshHostKeyError(message: string, host: string | undefined, port: number | undefined): string {
  if (!/host denied/i.test(message)) return message
  const where = `${host ?? ""}:${port ?? 22}`
  const rejection = rejections.get(where)
  if (!rejection || Date.now() - rejection.at > REJECTION_TTL_MS) return message
  const expected =
    rejection.expected === "LUX_SSH_HOST_KEY"
      ? "the LUX_SSH_HOST_KEY pin"
      : `stored ${rejection.expected}`
  return (
    `The SSH host key for ${where} does not match (${expected}, presented ${rejection.presented}). ` +
    "If the host was rebuilt or its key was rotated, forget the stored key in Settings → Auth or update LUX_SSH_HOST_KEY."
  )
}

/** Attach TOFU / pinned host-key verification to an ssh2 connection config. */
export function attachSshHostVerifier(config: ConnectConfig): ConnectConfig {
  const host = config.host ?? ""
  const port = config.port ?? 22
  return {
    ...config,
    hostVerifier: (key: Buffer, callback: (accepted: boolean) => void) => {
      try {
        callback(verifySshHostKey(host, port, key))
      } catch {
        callback(false)
      }
    },
  }
}
