import { sshExec, sshExecAccount } from "@/lib/goad-ssh"
import {
  buildLuxHostBinaryInstallShell,
  bundledLuxHostSha256,
  loadLuxHostScriptText,
  selectLuxHostInstallMode,
} from "@/lib/lux-host-install"

export type LuxHostSyncResult = {
  ok: boolean
  updated: boolean
  detail: string
}

let syncedHash: string | null = null
let nextAttemptAt = 0

function parseProbe(text: string): { uid: number | null; sudoAll: boolean; sudoHelper: boolean } {
  const uid = /^uid=(\d+)$/m.exec(text)
  return {
    uid: uid ? Number(uid[1]) : null,
    sudoAll: /^sudo_all=yes$/m.test(text),
    sudoHelper: /^sudo_helper=yes$/m.test(text),
  }
}

async function readInstalledRevision(): Promise<{ revision: string | null; version: number | null }> {
  let revision: string | null = null
  let version: number | null = null
  try {
    const rev = await sshExec(["revision"])
    if (rev.code === 0 && /^[0-9a-f]{64}$/.test(rev.stdout.trim())) revision = rev.stdout.trim()
  } catch {
    revision = null
  }
  try {
    const ver = await sshExec(["version"])
    if (ver.code === 0) {
      const n = Number.parseInt(ver.stdout.trim(), 10)
      if (Number.isFinite(n)) version = n
    }
  } catch {
    version = null
  }
  return { revision, version }
}

/**
 * Install the bundled lux-host when the copy on the Ludus host is older.
 * Root and passwordless full sudo can write the file directly. A helper that
 * already accepts `self-update` (version 3+) replaces itself, so later LUX
 * releases do not need another manual install.
 */
export async function ensureLuxHostCurrent(): Promise<LuxHostSyncResult> {
  const want = bundledLuxHostSha256()
  if (syncedHash === want) return { ok: true, updated: false, detail: "current" }
  if (Date.now() < nextAttemptAt) {
    return { ok: false, updated: false, detail: "waiting to retry" }
  }
  try {
    const result = await syncLuxHost(want)
    if (result.ok) syncedHash = want
    else nextAttemptAt = Date.now() + 10 * 60 * 1000
    if (result.updated) console.info(`[lux-host] ${result.detail}`)
    else if (!result.ok) console.warn(`[lux-host] ${result.detail}`)
    return result
  } catch (err) {
    nextAttemptAt = Date.now() + 10 * 60 * 1000
    const detail = err instanceof Error ? err.message : "lux-host sync failed"
    console.warn(`[lux-host] ${detail}`)
    return { ok: false, updated: false, detail }
  }
}

async function syncLuxHost(want: string): Promise<LuxHostSyncResult> {
  const installed = await readInstalledRevision()
  if (installed.revision === want) return { ok: true, updated: false, detail: "current" }

  const probe = await sshExecAccount(
    "printf 'uid=%s\\n' \"$(id -u)\"; if sudo -n true >/dev/null 2>&1; then echo sudo_all=yes; else echo sudo_all=no; fi; if sudo -n /usr/local/sbin/lux-host true >/dev/null 2>&1; then echo sudo_helper=yes; else echo sudo_helper=no; fi",
  )
  if (probe.code !== 0 && !probe.stdout.includes("uid=")) {
    return { ok: false, updated: false, detail: probe.stderr.trim() || "could not probe the Ludus host SSH account" }
  }
  const { uid, sudoAll, sudoHelper } = parseProbe(probe.stdout)
  const mode = selectLuxHostInstallMode({
    uid,
    sudoAll,
    sudoHelper,
    helperSupportsSelfUpdate: (installed.version ?? 0) >= 3,
    helperIsLegacy: false,
    hasUserPassword: false,
  })

  const script = loadLuxHostScriptText()
  const helperB64 = Buffer.from(script).toString("base64")
  if (mode === "root" || mode === "sudo-n") {
    const shell = buildLuxHostBinaryInstallShell(helperB64, mode)
    const written = await sshExecAccount(shell)
    if (written.code !== 0) {
      return { ok: false, updated: false, detail: written.stderr.trim() || "lux-host install failed" }
    }
  } else if (mode === "self-update") {
    const updated = await sshExec(["self-update"], undefined, { stdin: script })
    if (updated.code !== 0) {
      return { ok: false, updated: false, detail: updated.stderr.trim() || "lux-host self-update failed" }
    }
  } else {
    return {
      ok: false,
      updated: false,
      detail:
        "lux-host on the Ludus host is older than this LUX build, and the SSH account cannot write /usr/local/sbin/lux-host. Install it once from Settings → SSH & GOAD. After this version is on the host, later updates install themselves.",
    }
  }

  const after = await readInstalledRevision()
  if (after.revision !== want) {
    return { ok: false, updated: false, detail: "lux-host was written but its checksum does not match this LUX build" }
  }
  return { ok: true, updated: true, detail: "updated lux-host on the Ludus host" }
}
