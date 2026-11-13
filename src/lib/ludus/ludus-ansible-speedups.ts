import "server-only"

import { sshExec, sshExecAccount } from "@/lib/goad/goad-ssh"
import { bundledLuxHostSha256, loadLuxHostScriptText } from "@/lib/lux/lux-host-install"
import { ensureLuxHostCurrent } from "@/lib/lux/lux-host-sync"
import { luxHostMissingOperation } from "@/lib/range/range-deploy-host-patches"
import { getSettings } from "@/lib/settings/settings-store"
import { TtlCache } from "@/lib/core/server-cache"

/**
 * Toggle the Ludus server Ansible connection speedups (SSH pipelining + higher
 * fork count) through a systemd drop-in written by `lux-host ansible-speedups`.
 * Env only; no Ludus playbook is edited. Best-effort — a failure here is logged
 * and does not block the caller.
 */
export interface AnsibleSpeedupsResult {
  ok: boolean
  changed: boolean
  restart: string | null
  detail?: string
}

function parseResult(stdout: string, stderr: string, code: number): AnsibleSpeedupsResult {
  if (code !== 0) {
    return { ok: false, changed: false, restart: null, detail: (stderr || stdout).trim().slice(0, 300) }
  }
  const status = /^status=(ok|skipped)$/m.exec(stdout)?.[1]
  if (status !== "ok" && status !== "skipped") {
    return { ok: false, changed: false, restart: null, detail: "lux-host did not report a speedups status" }
  }
  return {
    ok: true,
    changed: /^changed=yes$/m.test(stdout),
    restart: /^restart=([a-z]+)$/m.exec(stdout)?.[1] ?? null,
  }
}

async function invokeInstalled(mode: "on" | "off"): Promise<AnsibleSpeedupsResult> {
  try {
    const result = await sshExec(["ansible-speedups", mode])
    return parseResult(result.stdout, result.stderr, result.code)
  } catch (err) {
    return { ok: false, changed: false, restart: null, detail: err instanceof Error ? err.message : "SSH failed" }
  }
}

async function invokeBundled(mode: "on" | "off"): Promise<AnsibleSpeedupsResult | null> {
  const script = loadLuxHostScriptText()
  const probe = await sshExecAccount("id -u").catch(() => null)
  const uid = probe && probe.code === 0 ? probe.stdout.trim() : ""
  const command = uid === "0" ? `bash -s -- ansible-speedups ${mode}` : `sudo -n bash -s -- ansible-speedups ${mode}`
  try {
    const result = await sshExecAccount(command, { stdin: script })
    const parsed = parseResult(result.stdout, result.stderr, result.code)
    if (!parsed.ok && /must run as root|a password is required|not allowed/i.test(parsed.detail ?? "")) return null
    return parsed
  } catch {
    return null
  }
}

export async function applyLudusAnsibleSpeedups(enabled: boolean): Promise<AnsibleSpeedupsResult> {
  const mode = enabled ? "on" : "off"
  const settings = getSettings()
  const key = [
    settings.sshHost,
    settings.sshPort || 22,
    settings.proxmoxSshUser || "root",
    mode,
    bundledLuxHostSha256(),
  ].join(":")
  return speedupsCache.resolve(key, () => applyLudusAnsibleSpeedupsUncached(mode), {
    cacheable: (result) => result.ok,
  })
}

const speedupsCache = new TtlCache<AnsibleSpeedupsResult>(10 * 60 * 1000, 8)

async function applyLudusAnsibleSpeedupsUncached(mode: "on" | "off"): Promise<AnsibleSpeedupsResult> {
  let sync = await ensureLuxHostCurrent()
  if (!sync.ok) console.warn(`[ansible-speedups] lux-host sync: ${sync.detail}`)
  let parsed = await invokeInstalled(mode)
  if (!parsed.ok && luxHostMissingOperation(parsed.detail ?? "")) {
    sync = await ensureLuxHostCurrent({ force: true })
    if (sync.ok) parsed = await invokeInstalled(mode)
  }
  if (!parsed.ok && luxHostMissingOperation(parsed.detail ?? "")) {
    const bundled = await invokeBundled(mode)
    if (bundled) parsed = bundled
  }
  if (!parsed.ok) console.warn(`[ansible-speedups] ${parsed.detail ?? "failed"}`)
  return parsed
}
