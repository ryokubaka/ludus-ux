import "server-only"

import { sshExec, sshExecAccount } from "@/lib/goad-ssh"
import { loadLuxHostScriptText } from "@/lib/lux-host-install"
import { ensureLuxHostCurrent } from "@/lib/lux-host-sync"
import { getSettings } from "@/lib/settings-store"

export type Debian11ArchivePatch =
  | { ok: true; changed: boolean; skipped: string | null; warning?: string }
  | { ok: false; error: string }

type HostPatchOp = "patch-debian11-apt" | "patch-chocolatey-openssh" | "patch-adguard-host-dns"

/** The installed helper predates this LUX build and rejected the operation name. */
export function luxHostMissingOperation(error: string): boolean {
  return /operation not allowed/i.test(error)
}

/**
 * Lux-host prints `status=ok|skipped` for the Debian 11 playbook edit.
 * A missing playbook or a renamed dbus task is a skip: the deploy can still
 * start. A non-zero exit means the file was not updated.
 */
export function parseDebian11ArchivePatch(
  stdout: string,
  stderr: string,
  code: number,
): Debian11ArchivePatch {
  if (code !== 0) {
    const detail = (stderr || stdout).trim().slice(0, 300)
    return { ok: false, error: detail || `lux-host exited ${code}` }
  }
  const status = /^status=(ok|skipped)$/m.exec(stdout)?.[1]
  if (status === "ok") {
    return { ok: true, changed: /^changed=yes$/m.test(stdout), skipped: null }
  }
  if (status === "skipped") {
    const reason = /^reason=(missing|task)$/m.exec(stdout)?.[1] ?? "unknown"
    return { ok: true, changed: false, skipped: reason }
  }
  return { ok: false, error: "lux-host did not report a Debian 11 apt patch status" }
}

/**
 * Untagged range deploy runs hostname setup. A tag list runs it only when it
 * includes `assign-ip` (static IPs and hostnames). Firewall-only and other
 * tag deploys do not execute that play.
 */
export function rangeDeployRunsHostnameSetup(body: unknown): boolean {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return true
  const tags = (body as { tags?: unknown }).tags
  if (typeof tags !== "string" || tags.trim() === "") return true
  const named = tags.split(",").map((tag) => tag.trim()).filter(Boolean)
  if (named.length === 0) return true
  return named.includes("assign-ip")
}

/** additional-tools and custom-choco run the Windows Chocolatey bootstrap. A full deploy does too. */
export function rangeDeployRunsWindowsTools(body: unknown): boolean {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return true
  const tags = (body as { tags?: unknown }).tags
  if (typeof tags !== "string" || tags.trim() === "") return true
  const named = tags.split(",").map((tag) => tag.trim()).filter(Boolean)
  if (named.length === 0) return true
  return named.some((tag) =>
    tag === "additional-tools" || tag === "custom-choco" || tag === "install-office" || tag === "install-visual-studio",
  )
}

/**
 * True when the deploy config names a Debian 11 guest (router template, vm_name, or Bullseye).
 * Debian 13 templates do not match. An empty config does not match: the guest task
 * exits immediately unless `/etc/os-release` says Debian 11, so a missed playbook
 * edit cannot break a Debian 13 deploy.
 */
export function deployNeedsDebian11Archive(configText: string | null | undefined): boolean {
  if (!configText) return false
  return /debian-11\b|router-debian11-x64|\bbullseye\b/i.test(configText)
}

/** Stop the deploy only when a Debian 11 guest will run the hostname play and the edit failed. */
export function debian11PatchBlocksDeploy(
  patch: Debian11ArchivePatch,
  body: unknown,
  configText: string | null | undefined,
): boolean {
  return !patch.ok && rangeDeployRunsHostnameSetup(body) && deployNeedsDebian11Archive(configText)
}

async function invokeInstalledPatch(op: HostPatchOp): Promise<Debian11ArchivePatch> {
  try {
    const result = await sshExec([op])
    return parseDebian11ArchivePatch(result.stdout, result.stderr, result.code)
  } catch (err) {
    const error = err instanceof Error ? err.message : "SSH failed"
    return { ok: false, error }
  }
}

/**
 * Run this build's helper from stdin. The copy in /usr/local/sbin may predate
 * the operation. Root runs it directly. An account with passwordless sudo runs
 * it the same way. A lux-host-only sudo rule cannot.
 */
async function invokeBundledPatch(op: HostPatchOp): Promise<Debian11ArchivePatch | null> {
  const script = loadLuxHostScriptText()
  const probe = await sshExecAccount("id -u").catch(() => null)
  const uid = probe && probe.code === 0 ? probe.stdout.trim() : ""
  const command = uid === "0" ? `bash -s -- ${op}` : `sudo -n bash -s -- ${op}`
  try {
    const result = await sshExecAccount(command, { stdin: script })
    const parsed = parseDebian11ArchivePatch(result.stdout, result.stderr, result.code)
    if (!parsed.ok && /must run as root|a password is required|not allowed/i.test(parsed.error)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Apply one playbook edit. Prefer the installed helper. If that helper does not
 * know the operation, update it once and retry, then run the script shipped
 * with this LUX build. A failure here is not fatal: the caller keeps deploying.
 */
async function applyHostPatch(op: HostPatchOp, logPrefix: string): Promise<Debian11ArchivePatch> {
  let sync = await ensureLuxHostCurrent()
  if (!sync.ok) console.warn(`[${logPrefix}] lux-host sync: ${sync.detail}`)
  let parsed = await invokeInstalledPatch(op)
  if (!parsed.ok && luxHostMissingOperation(parsed.error)) {
    sync = await ensureLuxHostCurrent({ force: true })
    if (!sync.ok) console.warn(`[${logPrefix}] lux-host sync: ${sync.detail}`)
    else parsed = await invokeInstalledPatch(op)
  }
  if (!parsed.ok && luxHostMissingOperation(parsed.error)) {
    const bundled = await invokeBundledPatch(op)
    if (bundled) parsed = bundled
  }
  if (!parsed.ok && luxHostMissingOperation(parsed.error) && !sync.ok) {
    parsed = { ok: false, error: `${parsed.error}. lux-host was not updated (${sync.detail})` }
  }
  if (parsed.ok && parsed.changed) {
    console.info(`[${logPrefix}] playbook updated`)
  } else if (parsed.ok && parsed.skipped) {
    console.warn(`[${logPrefix}] skipped (${parsed.skipped})`)
  } else if (!parsed.ok) {
    console.warn(`[${logPrefix}] ${parsed.error}`)
  }
  return parsed
}

/**
 * Rewrite Ludus's Linux hostname play so Debian 11 points bullseye-security at
 * the HTTPS archive before apt installs dbus. The guest task does nothing on
 * any other release.
 */
export async function ensureDebian11SecurityArchive(): Promise<Debian11ArchivePatch> {
  return applyHostPatch("patch-debian11-apt", "debian11-apt")
}

/** Install Chocolatey, then reboot once, before Ludus's win_chocolatey bootstrap. */
export async function ensureChocolateyOpenSshPatch(): Promise<Debian11ArchivePatch> {
  return applyHostPatch("patch-chocolatey-openssh", "chocolatey")
}

/**
 * Point AdGuardHome.yaml.j2 at 192.0.2.254. Range VMs use that resolver, and the
 * stock lists are public DNS. A Ludus update extracts a fresh template; this
 * runs again on the next deploy.
 */
export async function ensureAdguardHostDns(): Promise<Debian11ArchivePatch> {
  return applyHostPatch("patch-adguard-host-dns", "adguard-dns")
}

/**
 * Apply the host playbook edits a range deploy needs. A missed edit does not
 * stop the deploy: an older lux-host rejects the operation name, and the stock
 * Ludus plays still run.
 */
export async function ensureRangeDeployHostPatches(
  body: unknown,
  opts?: { configText?: string | null },
): Promise<Debian11ArchivePatch> {
  const apt = await ensureDebian11SecurityArchive()
  const choco = await ensureChocolateyOpenSshPatch()
  const dns = getSettings().useLudusHostDns
    ? await ensureAdguardHostDns()
    : ({ ok: true, changed: false, skipped: null } satisfies Debian11ArchivePatch)
  const warnings: string[] = []
  if (!apt.ok && debian11PatchBlocksDeploy(apt, body, opts?.configText)) {
    warnings.push(`Debian 11 apt edit skipped (${apt.error}). Deploy is continuing.`)
  } else if (!apt.ok) {
    console.warn(`[debian11-apt] continuing without the Bullseye archive task (${apt.error})`)
  }
  if (!choco.ok && rangeDeployRunsWindowsTools(body)) {
    warnings.push(`Chocolatey OpenSSH edit skipped (${choco.error}). Deploy is continuing.`)
  } else if (!choco.ok) {
    console.warn(`[chocolatey] continuing without the OpenSSH reboot task (${choco.error})`)
  }
  if (!dns.ok) {
    warnings.push(`AdGuard host DNS edit skipped (${dns.error}). Deploy is continuing.`)
  }
  return {
    ok: true,
    changed: (apt.ok && apt.changed) || (choco.ok && choco.changed) || (dns.ok && dns.changed),
    skipped: null,
    warning: warnings.length > 0 ? warnings.join(" ") : undefined,
  }
}
