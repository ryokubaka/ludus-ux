import { scryptSync, timingSafeEqual } from "crypto"
import type { RuntimeSettings } from "./settings-store"

/** Fields any authenticated user may see. Secrets stay on the server. */
export const PUBLIC_SETTINGS_KEYS = [
  "ludusUrl",
  "ludusAdminUrl",
  "sshHost",
  "sshPort",
  "goadPath",
  "ludushoundPath",
  "ludusInstallPath",
  "goadEnabled",
  "ludushoundEnabled",
  "ludusAnsibleVerbose",
  "useLudusHostDns",
] as const

export type PublicSettingsKey = (typeof PUBLIC_SETTINGS_KEYS)[number]

export type PublicSettings = Pick<RuntimeSettings, PublicSettingsKey>

export type AdminSettingsView = PublicSettings & {
  proxmoxSshUser: string
  proxmoxSshKeyPath: string
  rootApiKeySet: boolean
  proxmoxSshPasswordSet: boolean
  rootApiKeyOverriddenByEnv: boolean
}

export function toPublicSettings(
  settings: RuntimeSettings,
  opts: { isAdmin: boolean; rootApiKeyOverriddenByEnv?: boolean },
): PublicSettings | AdminSettingsView {
  const base: PublicSettings = {
    ludusUrl: settings.ludusUrl,
    ludusAdminUrl: settings.ludusAdminUrl,
    sshHost: settings.sshHost,
    sshPort: settings.sshPort,
    goadPath: settings.goadPath,
    ludushoundPath: settings.ludushoundPath,
    ludusInstallPath: settings.ludusInstallPath,
    goadEnabled: settings.goadEnabled,
    ludushoundEnabled: settings.ludushoundEnabled,
    ludusAnsibleVerbose: settings.ludusAnsibleVerbose,
    useLudusHostDns: settings.useLudusHostDns,
  }
  if (!opts.isAdmin) return base
  return {
    ...base,
    proxmoxSshUser: settings.proxmoxSshUser,
    proxmoxSshKeyPath: settings.proxmoxSshKeyPath,
    rootApiKeySet: settings.rootApiKey.trim().length > 0,
    proxmoxSshPasswordSet: settings.proxmoxSshPassword.trim().length > 0,
    rootApiKeyOverriddenByEnv: opts.rootApiKeyOverriddenByEnv === true,
  }
}

/** True when the caller is changing where API keys or SSH passwords are sent. */
export function endpointSettingsChanged(
  current: Pick<RuntimeSettings, "ludusUrl" | "ludusAdminUrl" | "sshHost" | "sshPort">,
  patch: Partial<RuntimeSettings>,
): boolean {
  if (patch.ludusUrl !== undefined && patch.ludusUrl.trim() !== current.ludusUrl.trim()) return true
  if (patch.ludusAdminUrl !== undefined && patch.ludusAdminUrl.trim() !== current.ludusAdminUrl.trim()) return true
  if (patch.sshHost !== undefined && patch.sshHost.trim() !== current.sshHost.trim()) return true
  if (patch.sshPort !== undefined && patch.sshPort !== current.sshPort) return true
  return false
}

/** Fixed salt: this compares two strings, it does not store a password. */
const SECRETS_MATCH_SALT = "ludus-ux-secrets-match"

/** Constant-time string compare. Empty expected secret never matches. */
export function secretsMatch(presented: string, expected: string): boolean {
  if (!expected) return false
  const a = scryptSync(presented, SECRETS_MATCH_SALT, 32)
  const b = scryptSync(expected, SECRETS_MATCH_SALT, 32)
  return timingSafeEqual(a, b)
}
