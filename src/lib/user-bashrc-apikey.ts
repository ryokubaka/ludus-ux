import { getSettings } from "@/lib/settings-store"
import { isRootProxmoxSshConfigured } from "@/lib/root-ssh-auth"
import { sshExec } from "@/lib/proxmox-ssh"

const POSIX_USER = /^[a-zA-Z0-9_.-]+$/

export function isValidLudusSshUsername(username: string): boolean {
  return POSIX_USER.test(username)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Strip export / quotes from a LUDUS_API_KEY=… line value. */
export function parseLudusApiKeyFromBashrcLine(line: string): string {
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

async function resolveHomeDir(
  host: string,
  port: number,
  sshUser: string,
  sshPw: string,
  linuxUser: string,
): Promise<string> {
  try {
    const home = (
      await sshExec(
        host,
        port,
        sshUser,
        sshPw,
        `getent passwd ${shellQuote(linuxUser)} 2>/dev/null | cut -d: -f6`,
      )
    ).trim()
    if (home) return home
  } catch {
    /* fall through */
  }
  return `/home/${linuxUser}`
}

async function readKeyFromHome(
  host: string,
  port: number,
  sshUser: string,
  sshPw: string,
  homeDir: string,
): Promise<string | null> {
  // Quote full paths — shellQuote(homeDir) + "/.bashrc" leaves quotes inside $f and breaks -f tests.
  const bashrc = shellQuote(`${homeDir}/.bashrc`)
  const profile = shellQuote(`${homeDir}/.profile`)
  const extractCmd =
    `(grep -E '(export[[:space:]]+)?LUDUS_API_KEY=' ${bashrc} 2>/dev/null; ` +
    `grep -E '(export[[:space:]]+)?LUDUS_API_KEY=' ${profile} 2>/dev/null) | tail -1; true`

  try {
    const line = await sshExec(host, port, sshUser, sshPw, extractCmd)
    const apiKey = parseLudusApiKeyFromBashrcLine(line)
    return apiKey || null
  } catch {
    return null
  }
}

/**
 * Read LUDUS_API_KEY from a Ludus user's shell init files via root SSH.
 * Mirrors roll-key SSH path: settings host + proxmox-ssh + getent home dir.
 */
export async function readUserApiKeyFromBashrc(
  username: string,
  options?: { ludusUserId?: string },
): Promise<{ apiKey: string | null; message?: string }> {
  const primary = username.trim().toLowerCase()
  if (!isValidLudusSshUsername(primary)) {
    return { apiKey: null, message: "Valid username required" }
  }

  const settings = getSettings()
  if (!settings.sshHost?.trim()) {
    return { apiKey: null, message: "LUDUS_SSH_HOST is not configured" }
  }
  if (!isRootProxmoxSshConfigured(settings)) {
    return {
      apiKey: null,
      message: "Root SSH not configured (set PROXMOX_SSH_PASSWORD or mount a root private key)",
    }
  }

  const host = settings.sshHost.trim()
  const port = settings.sshPort || 22
  const sshUser = settings.proxmoxSshUser || "root"
  const sshPw = settings.proxmoxSshPassword || ""

  const candidates = [primary]
  const alt = options?.ludusUserId?.trim().toLowerCase()
  if (alt && alt !== primary && isValidLudusSshUsername(alt)) {
    candidates.push(alt)
  }

  try {
    for (const linuxUser of candidates) {
      const homeDir = await resolveHomeDir(host, port, sshUser, sshPw, linuxUser)
      const apiKey = await readKeyFromHome(host, port, sshUser, sshPw, homeDir)
      if (apiKey) return { apiKey }
    }
    const tried = candidates.map((u) => `~${u}`).join(", ")
    return { apiKey: null, message: `Key not found in ${tried}/.bashrc (or .profile)` }
  } catch (err) {
    return {
      apiKey: null,
      message: err instanceof Error ? err.message : "SSH error reading ~/.bashrc",
    }
  }
}
