/**
 * Host writes (template dirs under /opt/ludus, chown, pvesh) SSH as PROXMOX_SSH_USER.
 * Ludus does not require that account to be named root. uid 0 works outright.
 * Any other account works when it can run `/usr/local/sbin/lux-host` with
 * `sudo -n`. That helper is the only passwordless command. A normal login
 * with neither root nor that rule fails the credential test.
 */

import { shellSingleQuote } from "@/lib/template-packer-paths"

export interface RootSshProbe {
  loginOk: boolean
  uid: number | null
  username: string | null
  /** Passwordless `sudo -n /usr/local/sbin/lux-host`. Null when the probe did not report it. */
  sudo: boolean | null
  /** Passwordless `sudo -n true`. Null when the probe did not report it. */
  sudoAll: boolean | null
  packerWritable: boolean | null
}

export interface ConfiguredSshUserAssessment {
  /** Account template copies and other host writes will use. */
  user: string
  isRoot: boolean
  /** Set when GOAD_SSH_USER overrides the Settings field. */
  fromEnv: boolean
  message: string | null
}

function cleanUser(value: string | null | undefined): string {
  return (value || "").replace(/\r/g, "").trim()
}

/** Same account `sshExec` uses for template install: GOAD_SSH_USER, else Settings, else root. */
export function effectivePrivilegedSshUser(settingsUser: string | null | undefined): string {
  return cleanUser(process.env.GOAD_SSH_USER) || cleanUser(settingsUser) || "root"
}

export function assessConfiguredSshUser(settingsUser: string | null | undefined): ConfiguredSshUserAssessment {
  const fromEnv = cleanUser(process.env.GOAD_SSH_USER)
  const configured = cleanUser(settingsUser) || "root"
  const user = fromEnv || configured
  return { user, isRoot: user === "root", fromEnv: !!fromEnv, message: null }
}

/** Passwordless sudo target. Quickstart installs this; sudoers allows only this path. */
export const LUX_HOST_SUDO_BIN = "/usr/local/sbin/lux-host"

/**
 * Run one named lux-host operation. Arguments are single-quoted so the remote
 * shell cannot reinterpret them. The helper refuses anything that is not one
 * of its operations. Root runs the binary directly. Any other account uses
 * `sudo -n` for that path only.
 */
export function formatLuxHost(username: string, args: readonly string[]): string {
  if (args.length === 0) {
    throw new Error("lux-host needs an operation")
  }
  for (const arg of args) {
    if (arg.includes("\0") || arg.includes("\n") || arg.includes("\r")) {
      throw new Error("lux-host arguments cannot contain newlines")
    }
  }
  const quoted = args.map((arg) => shellSingleQuote(arg)).join(" ")
  const user = cleanUser(username)
  if (user === "root" || !user) return `${LUX_HOST_SUDO_BIN} ${quoted}`
  return `sudo -n ${LUX_HOST_SUDO_BIN} ${quoted}`
}

/**
 * Root may run a host command directly. A non-root account cannot pass an
 * arbitrary shell string through lux-host.
 */
export function asPrivilegedShell(username: string, command: string): string {
  if (cleanUser(username) === "root" || !cleanUser(username)) return command
  throw new Error(
    "Refusing to run an arbitrary shell command through lux-host. Use a named lux-host operation.",
  )
}

function sudoProbeClauses(): string[] {
  return [
    `if sudo -n true >/dev/null 2>&1; then printf 'sudo_all=yes\\n'; else printf 'sudo_all=no\\n'; fi`,
    `if sudo -n ${LUX_HOST_SUDO_BIN} true >/dev/null 2>&1; then printf 'sudo=yes\\n'; else printf 'sudo=no\\n'; fi`,
  ]
}

/** uid plus passwordless sudo for every command and for the lux-host helper. */
export function buildLuxHostAuthProbeCommand(): string {
  return ["printf 'uid=%s\\n' \"$(id -u)\"", ...sudoProbeClauses()].join("; ")
}

/** One remote script. Exit 0 even when the packer dir is missing or not writable. */
export function buildRootSshProbeCommand(packerDir: string): string {
  const dir = shellSingleQuote(packerDir)
  return [
    "echo lux_root_ssh_ok",
    "printf 'uid=%s\\n' \"$(id -u)\"",
    "printf 'user=%s\\n' \"$(id -un)\"",
    ...sudoProbeClauses(),
    `if [ -d ${dir} ] && [ -w ${dir} ]; then printf 'packer_writable=yes\\n'; elif sudo -n ${LUX_HOST_SUDO_BIN} writable-dir ${dir}; then printf 'packer_writable=yes\\n'; else printf 'packer_writable=no\\n'; fi`,
  ].join("; ")
}

export function parseRootSshProbe(output: string): RootSshProbe {
  const loginOk = output.includes("lux_root_ssh_ok")
  const uidMatch = /^uid=(\d+)$/m.exec(output)
  const userMatch = /^user=(.+)$/m.exec(output)
  const sudoMatch = /^sudo=(yes|no)$/m.exec(output)
  const sudoAllMatch = /^sudo_all=(yes|no)$/m.exec(output)
  const writableMatch = /^packer_writable=(yes|no)$/m.exec(output)
  return {
    loginOk,
    uid: uidMatch ? Number(uidMatch[1]) : null,
    username: userMatch?.[1]?.trim() || null,
    sudo: sudoMatch ? sudoMatch[1] === "yes" : null,
    sudoAll: sudoAllMatch ? sudoAllMatch[1] === "yes" : null,
    packerWritable: writableMatch ? writableMatch[1] === "yes" : null,
  }
}

export type LuxHostInstallProbe = {
  user: string
  host: string
  port: number
  authAttempted: string
  uid?: number | null
  sudo?: boolean | null
  sudoAll?: boolean | null
}

/** Whether the Settings dialog may submit the lux-host installer. The host root password is required. */
export function canSubmitLuxHostInstall(input: {
  installing: boolean
  sshPassword: string
  rootPassword: string
  account: { user: string; host: string; port: number }
  probe: LuxHostInstallProbe | null
}): boolean {
  if (input.installing) return false
  return input.rootPassword.trim().length > 0
}

/** Why a successful login is still not usable for host writes. Null when it is. */
export function rootSshProbeProblem(probe: RootSshProbe, packerDir: string): string | null {
  if (!probe.loginOk) return null
  const who = probe.username || "that account"
  const elevated = probe.uid === 0 || probe.sudo === true
  if (probe.uid != null && !elevated) {
    return (
      `Login succeeded as ${who} (uid ${probe.uid}), without passwordless sudo for ${LUX_HOST_SUDO_BIN}. ` +
      `Host writes need root, or a sudoers rule for that helper only. Settings → SSH & GOAD can install that rule; quickstart can too.`
    )
  }
  if (probe.packerWritable === false) {
    return (
      `Logged in as ${who}, but ${packerDir} is missing or not writable by this account or via sudo. ` +
      `Template installs cannot create directories there.`
    )
  }
  return null
}
