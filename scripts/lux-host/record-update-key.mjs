/**
 * Persist the lux-host update key the way Settings does:
 * AES-256-GCM (`enc:v2:`) in SQLite `settings.luxHostUpdateKey`.
 * The key is read from stdin and is not printed.
 */
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const secret = process.env.APP_SECRET
if (!secret) {
  console.error("APP_SECRET is required to store the lux-host update key")
  process.exit(1)
}

const key = readFileSync(0, "utf8").trim()
if (!/^[0-9a-f]{64}$/.test(key)) {
  console.error("lux-host update key is invalid")
  process.exit(2)
}

const derived = pbkdf2Sync(secret, Buffer.from("ludus-ux-settings-salt-v1", "utf8"), 100_000, 32, "sha256")
const iv = randomBytes(12)
const cipher = createCipheriv("aes-256-gcm", derived, iv)
const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()])
const stored = `enc:v2:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data")
mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(path.join(dataDir, "ludus-ux.db"))
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)
db.prepare(
  "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
).run("luxHostUpdateKey", stored, Date.now())
db.close()
