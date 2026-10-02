import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { shellSingleQuote } from "@/lib/template-packer-paths"
import { LUX_HOST_SUDO_BIN } from "@/lib/root-ssh-preflight"

/** Same shape quickstart accepts for PROXMOX_SSH_USER. */
const LINUX_USER = /^[a-z_][a-z0-9_-]{0,31}$/

export type LuxHostInstallMode = "root" | "helper" | "sudo-n" | "sudo-s" | "self-update"

export function selectLuxHostInstallMode(input: {
  uid: number | null
  sudoAll: boolean
  sudoHelper: boolean
  /** True when the installed helper accepts `self-update` (version 3+). */
  helperSupportsSelfUpdate?: boolean
  /** True only for the old helper that runs a shell string. */
  helperIsLegacy?: boolean
  hasUserPassword: boolean
}): LuxHostInstallMode | null {
  if (input.uid === 0) return "root"
  if (input.sudoHelper && input.helperSupportsSelfUpdate) return "self-update"
  if (input.sudoHelper && input.helperIsLegacy) return "helper"
  if (input.sudoAll) return "sudo-n"
  if (input.hasUserPassword) return "sudo-s"
  return null
}

export function luxHostSudoUsernameError(user: string): string | null {
  const name = user.trim()
  if (!name) return "SSH user is empty"
  if (name === "root") return "root does not need the lux-host sudo rule"
  if (!LINUX_USER.test(name)) return "SSH user must be a plain Linux username"
  return null
}

export function renderLuxHostSudoers(template: string, user: string): string {
  return template.replace(/\r\n/g, "\n").replaceAll("__LUX_SSH_USER__", user.trim())
}

/**
 * The transmitted command is a base64 blob with no `$` and no newlines.
 */
export function buildLuxHostInstallShell(
  helperB64: string,
  sudoersB64: string,
  mode: Exclude<LuxHostInstallMode, "self-update">,
): string {
  const script = [
    "set -euo pipefail",
    "umask 077",
    "mkdir -p /usr/local/sbin /etc/sudoers.d",
    `printf '%s' ${shellSingleQuote(helperB64)} | base64 -d > /usr/local/sbin/lux-host`,
    "chown root:root /usr/local/sbin/lux-host",
    "chmod 755 /usr/local/sbin/lux-host",
    "tmp=$(mktemp)",
    `printf '%s' ${shellSingleQuote(sudoersB64)} | base64 -d > "$tmp"`,
    `visudo -cf "$tmp"`,
    `install -o root -g root -m 440 "$tmp" /etc/sudoers.d/lux-host`,
    `rm -f "$tmp"`,
  ].join("; ")
  const scriptB64 = Buffer.from(script).toString("base64")
  const write = `printf '%s' ${shellSingleQuote(scriptB64)} | base64 -d > /tmp/lux-host-install.sh`
  const run: Record<Exclude<LuxHostInstallMode, "self-update">, string> = {
    root: "bash /tmp/lux-host-install.sh",
    helper: `sudo -n ${LUX_HOST_SUDO_BIN} ${shellSingleQuote("bash /tmp/lux-host-install.sh")}`,
    "sudo-n": "sudo -n bash /tmp/lux-host-install.sh",
    "sudo-s": "sudo -S -p '' bash /tmp/lux-host-install.sh",
  }
  const wrapper = `${write} && ${run[mode]}; status=$?; rm -f /tmp/lux-host-install.sh /tmp/lux-host-install.wrap; exit $status`
  const wrapperB64 = Buffer.from(wrapper).toString("base64")
  return `printf '%s' ${shellSingleQuote(wrapperB64)} | base64 -d > /tmp/lux-host-install.wrap && bash /tmp/lux-host-install.wrap`
}

export function buildLuxHostBinaryInstallShell(
  helperB64: string,
  mode: "root" | "sudo-n",
): string {
  const script = [
    "set -euo pipefail",
    "umask 077",
    "mkdir -p /usr/local/sbin",
    `printf '%s' ${shellSingleQuote(helperB64)} | base64 -d > /usr/local/sbin/lux-host`,
    "chown root:root /usr/local/sbin/lux-host",
    "chmod 755 /usr/local/sbin/lux-host",
  ].join("; ")
  const scriptB64 = Buffer.from(script).toString("base64")
  const write = `printf '%s' ${shellSingleQuote(scriptB64)} | base64 -d > /tmp/lux-host-install.sh`
  const run = mode === "root" ? "bash /tmp/lux-host-install.sh" : "sudo -n bash /tmp/lux-host-install.sh"
  const wrapper = `${write} && ${run}; status=$?; rm -f /tmp/lux-host-install.sh /tmp/lux-host-install.wrap; exit $status`
  const wrapperB64 = Buffer.from(wrapper).toString("base64")
  return `printf '%s' ${shellSingleQuote(wrapperB64)} | base64 -d > /tmp/lux-host-install.wrap && bash /tmp/lux-host-install.wrap`
}

export function loadLuxHostScriptText(): string {
  const dir = path.join(process.cwd(), "scripts", "lux-host")
  return readFileSync(path.join(dir, "lux-host"), "utf8").replace(/\r\n/g, "\n")
}

export function bundledLuxHostSha256(): string {
  return createHash("sha256").update(loadLuxHostScriptText()).digest("hex")
}

export function loadLuxHostInstallPayload(user: string): { helperB64: string; sudoersB64: string } {
  const dir = path.join(process.cwd(), "scripts", "lux-host")
  const helper = loadLuxHostScriptText()
  const template = readFileSync(path.join(dir, "sudoers.in"), "utf8")
  return {
    helperB64: Buffer.from(helper).toString("base64"),
    sudoersB64: Buffer.from(renderLuxHostSudoers(template, user)).toString("base64"),
  }
}

/** sudo refuses accounts that are absent from sudoers before any password is checked. */
export function explainLuxHostInstallFailure(raw: string, user: string): string | null {
  if (/not in the sudoers file/i.test(raw)) {
    return (
      `${user} is not allowed to run sudo, so it cannot install this rule for itself. ` +
      `Enter the Ludus host root password in the dialog. It is used once to write the rule and is not saved.`
    )
  }
  return null
}

export function redactSecret(message: string, secret: string): string {
  const value = secret.trim()
  if (!value) return message
  return message.split(value).join("***")
}

export const LUX_HOST_VERIFY_CMD = `sudo -n ${LUX_HOST_SUDO_BIN} id`
