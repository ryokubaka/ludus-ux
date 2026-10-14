import "server-only"

import { sshExec } from "@/lib/goad-ssh"
import { ensureLuxHostCurrent } from "@/lib/lux-host-sync"

export type Debian11ArchivePatch =
  | { ok: true; changed: boolean; skipped: string | null }
  | { ok: false; error: string }

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

export function debian11ArchiveBlockMessage(error: string): string {
  return `Debian 11 apt sources were not updated on the Ludus host (${error}). Host SSH has to run lux-host before deploy. Bullseye security packages are on https://archive.debian.org.`
}

export function chocolateyOpenSshBlockMessage(error: string): string {
  return `Chocolatey was not prepared on the Ludus host (${error}). Host SSH has to run lux-host before deploy. Windows OpenSSH does not see choco.exe until the VM reboots.`
}

/**
 * Rewrite Ludus's Linux hostname play so Debian 11 points bullseye-security at
 * the HTTPS archive before apt installs dbus. The guest task runs during deploy.
 */
export async function ensureDebian11SecurityArchive(): Promise<Debian11ArchivePatch> {
  const sync = await ensureLuxHostCurrent()
  if (!sync.ok) {
    return { ok: false, error: sync.detail }
  }
  try {
    const result = await sshExec(["patch-debian11-apt"])
    const parsed = parseDebian11ArchivePatch(result.stdout, result.stderr, result.code)
    if (parsed.ok && parsed.changed) {
      console.info("[debian11-apt] hostname play now points Bullseye security apt at the HTTPS archive")
    } else if (parsed.ok && parsed.skipped) {
      console.warn(`[debian11-apt] skipped (${parsed.skipped})`)
    } else if (!parsed.ok) {
      console.warn(`[debian11-apt] ${parsed.error}`)
    }
    return parsed
  } catch (err) {
    const error = err instanceof Error ? err.message : "SSH failed"
    console.warn(`[debian11-apt] ${error}`)
    return { ok: false, error }
  }
}

/** Install Chocolatey, then reboot once, before Ludus's win_chocolatey bootstrap. */
export async function ensureChocolateyOpenSshPatch(): Promise<Debian11ArchivePatch> {
  const sync = await ensureLuxHostCurrent()
  if (!sync.ok) {
    return { ok: false, error: sync.detail }
  }
  try {
    const result = await sshExec(["patch-chocolatey-openssh"])
    const parsed = parseDebian11ArchivePatch(result.stdout, result.stderr, result.code)
    if (parsed.ok && parsed.changed) {
      console.info("[chocolatey] Windows tools play installs Chocolatey and reboots once so OpenSSH can see choco.exe")
    } else if (parsed.ok && parsed.skipped) {
      console.warn(`[chocolatey] skipped (${parsed.skipped})`)
    } else if (!parsed.ok) {
      console.warn(`[chocolatey] ${parsed.error}`)
    }
    return parsed
  } catch (err) {
    const error = err instanceof Error ? err.message : "SSH failed"
    console.warn(`[chocolatey] ${error}`)
    return { ok: false, error }
  }
}

/**
 * Apply the host playbook edits a range deploy needs. A tag-limited deploy
 * ignores a patch for a play it will not run.
 */
export async function ensureRangeDeployHostPatches(body: unknown): Promise<Debian11ArchivePatch> {
  const apt = await ensureDebian11SecurityArchive()
  if (!apt.ok && rangeDeployRunsHostnameSetup(body)) {
    return { ok: false, error: debian11ArchiveBlockMessage(apt.error) }
  }
  const choco = await ensureChocolateyOpenSshPatch()
  if (!choco.ok && rangeDeployRunsWindowsTools(body)) {
    return { ok: false, error: chocolateyOpenSshBlockMessage(choco.error) }
  }
  return {
    ok: true,
    changed: (apt.ok && apt.changed) || (choco.ok && choco.changed),
    skipped: null,
  }
}
