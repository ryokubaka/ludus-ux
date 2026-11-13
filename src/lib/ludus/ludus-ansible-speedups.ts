import "server-only"

import { sshExec, sshExecAccount } from "@/lib/goad/goad-ssh"
import { bundledLuxHostSha256, loadLuxHostScriptText } from "@/lib/lux/lux-host-install"
import { ensureLuxHostCurrent } from "@/lib/lux/lux-host-sync"
import { luxHostMissingOperation } from "@/lib/range/range-deploy-host-patches"
import { getSettings } from "@/lib/settings/settings-store"
import { TtlCache } from "@/lib/core/server-cache"

/**
 * Ludus server Ansible environment, written as systemd drop-ins by lux-host.
 * Speedups are SSH pipelining and a higher fork count. The Windows async
 * startup timeout is 120 seconds for every Windows async task, including
 * Start Sysprep. Env only; no Ludus playbook is edited. Best-effort — a
 * failure here is logged and does not block the caller.
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

function shellArgs(args: string[]): string {
  return args.map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`).join(" ")
}

async function invokeInstalled(args: string[]): Promise<AnsibleSpeedupsResult> {
  try {
    const result = await sshExec(args)
    return parseResult(result.stdout, result.stderr, result.code)
  } catch (err) {
    return { ok: false, changed: false, restart: null, detail: err instanceof Error ? err.message : "SSH failed" }
  }
}

async function invokeBundled(args: string[]): Promise<AnsibleSpeedupsResult | null> {
  const script = loadLuxHostScriptText()
  const probe = await sshExecAccount("id -u").catch(() => null)
  const uid = probe && probe.code === 0 ? probe.stdout.trim() : ""
  const rendered = shellArgs(args)
  const command = uid === "0" ? `bash -s -- ${rendered}` : `sudo -n bash -s -- ${rendered}`
  try {
    const result = await sshExecAccount(command, { stdin: script })
    const parsed = parseResult(result.stdout, result.stderr, result.code)
    if (!parsed.ok && /must run as root|a password is required|not allowed/i.test(parsed.detail ?? "")) return null
    return parsed
  } catch {
    return null
  }
}

const speedupsCache = new TtlCache<AnsibleSpeedupsResult>(10 * 60 * 1000, 8)
const winAsyncCache = new TtlCache<AnsibleSpeedupsResult>(10 * 60 * 1000, 8)

async function applyHostOperation(args: string[], label: string, cache: TtlCache<AnsibleSpeedupsResult>): Promise<AnsibleSpeedupsResult> {
  const settings = getSettings()
  const key = [
    settings.sshHost,
    settings.sshPort || 22,
    settings.proxmoxSshUser || "root",
    args.join("\0"),
    bundledLuxHostSha256(),
  ].join(":")
  return cache.resolve(key, () => applyHostOperationUncached(args, label), {
    cacheable: (result) => result.ok,
  })
}

async function applyHostOperationUncached(args: string[], label: string): Promise<AnsibleSpeedupsResult> {
  let sync = await ensureLuxHostCurrent()
  if (!sync.ok) console.warn(`[${label}] lux-host sync: ${sync.detail}`)
  let parsed = await invokeInstalled(args)
  if (!parsed.ok && luxHostMissingOperation(parsed.detail ?? "")) {
    sync = await ensureLuxHostCurrent({ force: true })
    if (sync.ok) parsed = await invokeInstalled(args)
  }
  if (!parsed.ok && luxHostMissingOperation(parsed.detail ?? "")) {
    const bundled = await invokeBundled(args)
    if (bundled) parsed = bundled
  }
  if (!parsed.ok) console.warn(`[${label}] ${parsed.detail ?? "failed"}`)
  return parsed
}

export async function applyLudusAnsibleSpeedups(enabled: boolean): Promise<AnsibleSpeedupsResult> {
  return applyHostOperation(["ansible-speedups", enabled ? "on" : "off"], "ansible-speedups", speedupsCache)
}

/** 120 seconds for every Windows async task the Ludus service starts. */
export async function applyLudusWinAsyncTimeout(): Promise<AnsibleSpeedupsResult> {
  return applyHostOperation(["win-async-timeout"], "win-async-timeout", winAsyncCache)
}
