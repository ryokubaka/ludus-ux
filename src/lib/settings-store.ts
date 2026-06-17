/**
 * Runtime settings store.
 *
 * Layering (lowest → highest priority):
 *   1. Compiled defaults (constants for missing values)
 *   2. Environment variables (read lazily at runtime, never at build time)
 *   3. User overrides saved via the Settings UI (persisted to SQLite)
 *
 * Exception: `rootApiKey` — non-empty `LUDUS_ROOT_API_KEY` wins after merge (see
 * `resolveRootApiKey`); SQLite/UI value used only when env unset or whitespace-only.
 * At rest, `rootApiKey` and `proxmoxSshPassword` are AES-256-GCM encrypted (APP_SECRET).
 *
 * Overrides survive container restarts because they are stored in the
 * volume-mounted SQLite database at $DATA_DIR/ludus-ux.db.
 */

import { getDb } from "./db"
import { normalizeLudusApiKeyInput, resolveRootApiKey } from "./resolve-root-api-key"
import {
  decryptSettingsValueAtRest,
  encryptSettingsValueAtRest,
  isSettingsValueAtRestEncrypted,
} from "./settings-value-at-rest"

export interface RuntimeSettings {
  ludusUrl: string
  ludusAdminUrl: string
  sshHost: string
  sshPort: number
  goadPath: string
  /** Whether the GOAD integration is shown in the UI. Defaults to true. */
  goadEnabled: boolean
  /** ROOT API key — used for admin operations (user create/delete). */
  rootApiKey: string
  /** Ludus admin user API key for global source blueprint install/share (auto-set on first admin source install). */
  blueprintOperatorApiKey: string
  /** Ludus userID of the admin who installed global source blueprints. */
  blueprintOperatorUserId: string
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

// NOTE: Do NOT read process.env here at module-level; Next.js standalone builds
// may inline those values at build time (before the container env is set).
// `getSettings()` merges lazily-read env via `defaults()` on each call.
//
// SQLite overrides are read on every `getSettings()` — no in-process cache.
// Next can run multiple workers; a save on one worker must be visible to others
// (cached module state caused stale ludusUrl / admin URL until restart).

/** Keys whose SQLite `value` column stores `enc:v1:` ciphertext (decrypted only server-side). */
const SETTINGS_SECRET_KEYS: Array<keyof RuntimeSettings> = [
  "proxmoxSshPassword",
  "rootApiKey",
  "blueprintOperatorApiKey",
]

function appSecretForSettingsAtRest(): string {
  return process.env.APP_SECRET || "change-me-in-production-32-chars!!"
}

function defaults(): RuntimeSettings {
  return {
    ludusUrl: process.env.LUDUS_URL || "https://198.51.100.1:8080",
    ludusAdminUrl: process.env.LUDUS_ADMIN_URL || "",
    sshHost: process.env.LUDUS_SSH_HOST || process.env.GOAD_SSH_HOST || "",
    sshPort: parseInt(process.env.LUDUS_SSH_PORT || process.env.GOAD_SSH_PORT || "22", 10),
    goadPath: process.env.GOAD_PATH || "/opt/GOAD",
    goadEnabled: process.env.ENABLE_GOAD !== "false",
    rootApiKey: normalizeLudusApiKeyInput(process.env.LUDUS_ROOT_API_KEY),
    blueprintOperatorApiKey: normalizeLudusApiKeyInput(
      process.env.LUX_LUDUS_BLUEPRINT_OPERATOR_API_KEY,
    ),
    blueprintOperatorUserId: "",
    proxmoxSshUser: process.env.PROXMOX_SSH_USER || "root",
    proxmoxSshPassword: process.env.PROXMOX_SSH_PASSWORD || "",
    proxmoxSshKeyPath: "",
  }
}

// ── DB persistence helpers ────────────────────────────────────────────────────

const SETTINGS_KEYS: Array<keyof RuntimeSettings> = [
  "ludusUrl",
  "ludusAdminUrl",
  "sshHost",
  "sshPort",
  "goadPath",
  "goadEnabled",
  "rootApiKey",
  "blueprintOperatorApiKey",
  "blueprintOperatorUserId",
  "proxmoxSshUser",
  "proxmoxSshPassword",
  "proxmoxSshKeyPath",
]

function encodeSettingForDb(key: string, value: unknown): string {
  const text = String(value)
  return SETTINGS_SECRET_KEYS.includes(key as keyof RuntimeSettings)
    ? encryptSettingsValueAtRest(text, appSecretForSettingsAtRest())
    : text
}

function decodeSettingFromDb(key: string, value: string): { value: string; needsRewrite: boolean } {
  if (!SETTINGS_SECRET_KEYS.includes(key as keyof RuntimeSettings)) {
    return { value, needsRewrite: false }
  }
  if (!value || !isSettingsValueAtRestEncrypted(value)) {
    return { value, needsRewrite: !!value }
  }
  try {
    return {
      value: decryptSettingsValueAtRest(value, appSecretForSettingsAtRest()),
      needsRewrite: false,
    }
  } catch (err) {
    console.error(`[settings-store] Failed to decrypt ${key} from DB:`, err)
    return { value: "", needsRewrite: false }
  }
}

function loadOverridesFromDb(): Partial<RuntimeSettings> {
  try {
    const db = getDb()
    const rows = db
      .prepare("SELECT key, value FROM settings")
      .all() as Array<{ key: string; value: string }>

    const result: Partial<RuntimeSettings> = {}
    for (const { key, value } of rows) {
      if (!SETTINGS_KEYS.includes(key as keyof RuntimeSettings)) continue
      const k = key as keyof RuntimeSettings
      const decoded = decodeSettingFromDb(key, value)
      // Coerce stored strings back to the right type
      if (k === "goadEnabled") {
        (result as Record<string, unknown>)[k] = decoded.value === "true"
      } else if (k === "sshPort") {
        const n = parseInt(decoded.value, 10)
        if (!isNaN(n)) (result as Record<string, unknown>)[k] = n
      } else {
        (result as Record<string, unknown>)[k] = decoded.value
      }
      if (decoded.needsRewrite) {
        db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?").run(
          encryptSettingsValueAtRest(decoded.value, appSecretForSettingsAtRest()),
          Date.now(),
          key
        )
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
        upsert.run(k, encodeSettingForDb(k, v), now)
      }
    })
    saveAll()
  } catch (err) {
    console.error("[settings-store] DB save failed:", err)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getSettings(): RuntimeSettings {
  const overrides = loadOverridesFromDb()
  // SQLite "" for optional URLs must not override env / boot tunnel — Settings POST
  // sends the full form; blank fields serialize as "" and would wipe LUDUS_* defaults.
  if ((overrides.ludusUrl ?? "").trim() === "") {
    delete overrides.ludusUrl
  }
  if ((overrides.ludusAdminUrl ?? "").trim() === "") {
    delete overrides.ludusAdminUrl
  }
  if ((overrides.rootApiKey ?? "").trim() === "") {
    delete overrides.rootApiKey
  }
  const effective = { ...defaults(), ...overrides }
  effective.rootApiKey = resolveRootApiKey(process.env.LUDUS_ROOT_API_KEY, effective.rootApiKey)
  effective.ludusUrl = effective.ludusUrl.trim()
  effective.ludusAdminUrl = effective.ludusAdminUrl.trim()
  return effective
}

export function updateSettings(patch: Partial<RuntimeSettings>): RuntimeSettings {
  saveOverridesToDb(patch)
  return getSettings()
}
