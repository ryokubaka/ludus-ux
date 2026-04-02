/**
 * Runtime settings store.
 *
 * Layering (lowest → highest priority):
 *   1. Compiled defaults (constants for missing values)
 *   2. Environment variables (read lazily at runtime, never at build time)
 *   3. User overrides saved via the Settings UI (persisted to SQLite)
 *
 * Overrides survive container restarts because they are stored in the
 * volume-mounted SQLite database at $DATA_DIR/ludus-ux.db.
 */

import { getDb } from "./db"

export interface RuntimeSettings {
  ludusUrl: string
  ludusAdminUrl: string
  verifyTls: boolean
  sshHost: string
  sshPort: number
  goadPath: string
  /** Whether the GOAD integration is shown in the UI. Defaults to true. */
  goadEnabled: boolean
  /** ROOT API key — used for admin operations (user create/delete). */
  rootApiKey: string
  /** Proxmox/root SSH user — used for VM console (SPICE) access. Defaults to "root". */
  proxmoxSshUser: string
  /** Proxmox/root SSH password — used for VM console (SPICE) access. */
  proxmoxSshPassword: string
  /**
   * Optional path to root SSH private key inside the container (e.g. /app/ssh/id_rsa).
   * When set, tried before PROXMOX_SSH_KEY_PATH env — survives Next/env oddities and is saved in SQLite.
   */
  proxmoxSshKeyPath: string
}

// Module-level overrides loaded from the DB + any in-process mutations.
// NOTE: Do NOT read process.env here at module-level; Next.js standalone builds
// may inline those values at build time (before the container env is set).
// Instead, `getSettings()` lazily merges runtime env vars on first call.
let overrides: Partial<RuntimeSettings> = {}
let initialized = false

function defaults(): RuntimeSettings {
  return {
    ludusUrl: process.env.LUDUS_URL || "https://198.51.100.1:8080",
    ludusAdminUrl: process.env.LUDUS_ADMIN_URL || "",
    verifyTls: process.env.LUDUS_VERIFY_TLS === "true",
    sshHost: process.env.LUDUS_SSH_HOST || process.env.GOAD_SSH_HOST || "",
    sshPort: parseInt(process.env.LUDUS_SSH_PORT || process.env.GOAD_SSH_PORT || "22", 10),
    goadPath: process.env.GOAD_PATH || "/opt/GOAD",
    goadEnabled: process.env.ENABLE_GOAD !== "false",
    rootApiKey: process.env.LUDUS_ROOT_API_KEY || "",
    proxmoxSshUser: process.env.PROXMOX_SSH_USER || "root",
    proxmoxSshPassword: process.env.PROXMOX_SSH_PASSWORD || "",
    proxmoxSshKeyPath: "",
  }
}

// ── DB persistence helpers ────────────────────────────────────────────────────

const SETTINGS_KEYS: Array<keyof RuntimeSettings> = [
  "ludusUrl",
  "ludusAdminUrl",
  "verifyTls",
  "sshHost",
  "sshPort",
  "goadPath",
  "goadEnabled",
  "rootApiKey",
  "proxmoxSshUser",
  "proxmoxSshPassword",
  "proxmoxSshKeyPath",
]

function loadOverridesFromDb(): Partial<RuntimeSettings> {
  try {
    const rows = getDb()
      .prepare("SELECT key, value FROM settings")
      .all() as Array<{ key: string; value: string }>

    const result: Partial<RuntimeSettings> = {}
    for (const { key, value } of rows) {
      if (!SETTINGS_KEYS.includes(key as keyof RuntimeSettings)) continue
      const k = key as keyof RuntimeSettings
      // Coerce stored strings back to the right type
      if (k === "verifyTls" || k === "goadEnabled") {
        (result as Record<string, unknown>)[k] = value === "true"
      } else if (k === "sshPort") {
        const n = parseInt(value, 10)
        if (!isNaN(n)) (result as Record<string, unknown>)[k] = n
      } else {
        (result as Record<string, unknown>)[k] = value
      }
    }
    return result
  } catch {
    // DB not ready yet or settings table missing — return empty (env vars will be used)
    return {}
  }
}

function saveOverridesToDb(patch: Partial<RuntimeSettings>): void {
  try {
    const db = getDb()
    const upsert = db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
    const now = Date.now()
    const saveAll = db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue
        upsert.run(k, String(v), now)
      }
    })
    saveAll()
  } catch (err) {
    console.error("[settings-store] DB save failed:", err)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getSettings(): RuntimeSettings {
  if (!initialized) {
    overrides = loadOverridesFromDb()
    const d = defaults()
    const effective = { ...d, ...overrides }
    if (!effective.verifyTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
    }
    initialized = true
  }
  return { ...defaults(), ...overrides }
}

export function updateSettings(patch: Partial<RuntimeSettings>): RuntimeSettings {
  // Ensure overrides are loaded before mutating
  if (!initialized) getSettings()
  overrides = { ...overrides, ...patch }
  saveOverridesToDb(patch)
  if ("verifyTls" in patch) {
    const effective = { ...defaults(), ...overrides }
    if (!effective.verifyTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
    } else {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    }
  }
  return getSettings()
}
