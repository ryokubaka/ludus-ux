/**
 * While the LUX server is up, read ansible.log on the Ludus host and stamp each
 * new line with the host clock. A closed browser does not stop this.
 */

import "server-only"

import { assessConfiguredSshUser, effectivePrivilegedSshUser } from "@/lib/ssh/root-ssh-preflight"
import { sshExec } from "@/lib/ssh/proxmox-ssh"
import { getSettings } from "@/lib/settings/settings-store"
import { isRootProxmoxSshConfigured } from "@/lib/ssh/root-ssh-auth"
import { refreshLudusWallClockFromSsh } from "@/lib/ludus/ludus-wall-clock"
import { getLudusWallClockMs } from "@/lib/ludus/ludus-wall-clock-bridge"
import { deployLogClockPrefix, extendDeployLogClock, omitBlankLogLines } from "@/lib/logs/log-line-timestamp"
import { probeBackoffMs } from "@/lib/logs/probe-backoff"
import { splitLogText } from "@/lib/logs/strip-ansi"
import {
  listDeployLogClocks,
  newDeployLogClockId,
  pruneDeployLogClocks,
  saveDeployLogClock,
} from "@/lib/logs/deploy-log-clock-store"

const POLL_MS = 2_000
const ACTIVE_AGE_SEC = 90
const MAX_LOG_CHARS = 3_000_000

type ActiveLog = { id: string; bytes: number }

type RecorderGlobal = typeof globalThis & {
  __luxDeployLogClockStarted?: boolean
  __luxDeployLogClockTimer?: ReturnType<typeof setInterval>
}

const seenBytes = new Map<string, number>()
let passRunning = false
let activeOpMissing = false
let consecutiveFailures = 0
let nextProbeAt = 0

function parseActive(text: string): ActiveLog[] {
  const out: ActiveLog[] = []
  for (const line of text.split("\n")) {
    const parts = line.trim().split("\t")
    const id = parts[0] ?? ""
    const bytes = Number(parts[1])
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue
    if (!Number.isFinite(bytes) || bytes < 0) continue
    out.push({ id, bytes })
  }
  return out
}

async function listActiveLogs(): Promise<ActiveLog[]> {
  const settings = getSettings()
  if (!settings.sshHost?.trim() || !isRootProxmoxSshConfigured(settings)) return []
  const user = effectivePrivilegedSshUser(settings.proxmoxSshUser)
  const port = settings.sshPort ?? 22
  const password = settings.proxmoxSshPassword || ""
  if (!activeOpMissing) {
    try {
      const out = await sshExec(settings.sshHost, port, user, password, [
        "range-log",
        "active",
        String(ACTIVE_AGE_SEC),
      ])
      return parseActive(out)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      if (/range-log/.test(msg)) activeOpMissing = true
      else throw err
    }
  }
  if (assessConfiguredSshUser(user).isRoot) {
    const out = await sshExec(
      settings.sshHost,
      port,
      user,
      password,
      `now=$(date +%s); for log in /opt/ludus/ranges/*/ansible.log; do [ -f "$log" ] || continue; mt=$(stat -c %Y "$log" 2>/dev/null || echo 0); age=$((now - mt)); [ "$age" -le ${ACTIVE_AGE_SEC} ] || continue; id=$(basename "$(dirname "$log")"); bytes=$(stat -c %s "$log" 2>/dev/null || echo 0); printf '%s\\t%s\\n' "$id" "$bytes"; done`,
      { elevate: false },
    )
    return parseActive(out)
  }
  return []
}

type ReadResult = { text: string | null; failed: boolean }

async function readLog(rangeId: string): Promise<ReadResult> {
  const settings = getSettings()
  if (!settings.sshHost?.trim() || !isRootProxmoxSshConfigured(settings)) return { text: null, failed: false }
  try {
    const content = await sshExec(
      settings.sshHost,
      settings.sshPort ?? 22,
      effectivePrivilegedSshUser(settings.proxmoxSshUser),
      settings.proxmoxSshPassword || "",
      ["range-log", "read", rangeId],
    )
    if (!content.trim()) return { text: null, failed: false }
    if (content.length > MAX_LOG_CHARS) return { text: null, failed: false }
    return { text: content, failed: false }
  } catch {
    return { text: null, failed: true }
  }
}

async function recordOne(rangeId: string, observedAtMs: number): Promise<"stamped" | "skipped" | "failed"> {
  const { text, failed } = await readLog(rangeId)
  if (failed) return "failed"
  if (text == null) return "skipped"
  const raw = omitBlankLogLines(splitLogText(text))
  if (raw.length === 0) return "skipped"
  const generations = listDeployLogClocks(rangeId)
  let best: { id: string; entries: ReturnType<typeof listDeployLogClocks>[number]["entries"] } | null = null
  let bestN = 0
  for (const generation of generations) {
    const n = deployLogClockPrefix(raw, generation.entries)
    if (n !== generation.entries.length || n === 0) continue
    if (n > bestN) {
      best = generation
      bestN = n
    }
  }
  const extended = extendDeployLogClock(best?.entries ?? [], raw, observedAtMs)
  if (extended.fresh || !best) {
    saveDeployLogClock(rangeId, newDeployLogClockId(), extended.entries)
    return "stamped"
  }
  if (extended.entries.length !== best.entries.length) {
    saveDeployLogClock(rangeId, best.id, extended.entries)
  }
  return "stamped"
}

export async function recordActiveDeployLogs(): Promise<{ failed: boolean }> {
  const active = await listActiveLogs()
  if (active.length === 0) return { failed: false }
  await refreshLudusWallClockFromSsh()
  const observedAtMs = getLudusWallClockMs()
  let failed = false
  for (const row of active) {
    if (seenBytes.get(row.id) === row.bytes) continue
    const outcome = await recordOne(row.id, observedAtMs)
    if (outcome === "failed") failed = true
    else if (outcome === "stamped") seenBytes.set(row.id, row.bytes)
  }
  return { failed }
}

export function startDeployLogClockLoop(): void {
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build") return
  const g = globalThis as RecorderGlobal
  if (g.__luxDeployLogClockStarted) return
  g.__luxDeployLogClockStarted = true
  const tick = () => {
    if (passRunning) return
    if (Date.now() < nextProbeAt) return
    passRunning = true
    void (async () => {
      let failed = false
      try {
        pruneDeployLogClocks()
        const result = await recordActiveDeployLogs()
        failed = result.failed
      } catch (err) {
        failed = true
        console.warn("[deploy-log-clock]", err instanceof Error ? err.message : err)
      } finally {
        passRunning = false
        consecutiveFailures = failed ? consecutiveFailures + 1 : 0
        nextProbeAt = failed ? Date.now() + probeBackoffMs(consecutiveFailures) : 0
      }
    })()
  }
  setTimeout(tick, 5_000)
  g.__luxDeployLogClockTimer = setInterval(tick, POLL_MS)
  g.__luxDeployLogClockTimer.unref?.()
}

export function ensureDeployLogClockLoopStarted(): void {
  startDeployLogClockLoop()
}
