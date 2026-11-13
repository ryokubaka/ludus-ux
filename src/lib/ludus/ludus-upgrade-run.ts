import "server-only"

import { sshExec } from "@/lib/goad/goad-ssh"
import { ensureLuxHostCurrent } from "@/lib/lux/lux-host-sync"
import { getLudusReleasesSnapshot } from "@/lib/ludus/ludus-releases-fetch"
import { mapLudusUpgradeError, normalizeLudusTag } from "@/lib/ludus/ludus-releases"

export type LudusUpgradeStart =
  | { ok: true; tag: string }
  | { ok: false; status: number; error: string }

export type LudusUpgradeStatus = {
  active: boolean
  logTail: string
  error?: string
}

export async function startLudusUpgrade(tag: string, apiKey: string): Promise<LudusUpgradeStart> {
  const version = normalizeLudusTag(tag)
  if (!version) return { ok: false, status: 400, error: "That version is not a release this host will install." }
  const snap = await getLudusReleasesSnapshot(apiKey)
  const row = snap.releases.find((r) => r.tag === version)
  if (!row?.canUpgrade) {
    return { ok: false, status: 400, error: "That release is not a newer stable version." }
  }
  const sync = await ensureLuxHostCurrent()
  if (!sync.ok) return { ok: false, status: 503, error: sync.detail }
  let result: { stdout: string; stderr: string; code: number }
  try {
    result = await sshExec(["ludus-upgrade", version])
  } catch (err) {
    const message = err instanceof Error ? err.message : "SSH to the Ludus host failed."
    return { ok: false, status: 502, error: message }
  }
  if (result.code !== 0 || !result.stdout.includes("started")) {
    return { ok: false, status: 502, error: mapLudusUpgradeError(result.stderr || result.stdout) }
  }
  return { ok: true, tag: version }
}

export async function readLudusUpgradeStatus(): Promise<LudusUpgradeStatus> {
  try {
    const result = await sshExec(["ludus-upgrade-log"])
    if (result.code !== 0) {
      return { active: false, logTail: "", error: mapLudusUpgradeError(result.stderr || result.stdout) }
    }
    const text = result.stdout.replace(/\r\n/g, "\n")
    const active = /^active=yes$/m.test(text)
    const logTail = text.replace(/^active=(yes|no)\n?/, "")
    return { active, logTail }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read the upgrade log."
    return { active: false, logTail: "", error: message }
  }
}
