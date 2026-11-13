import "server-only"

import { sshExec, sshExecAccount } from "@/lib/goad/goad-ssh"
import { loadLuxHostScriptText, bundledLuxHostSha256 } from "@/lib/lux/lux-host-install"
import { ensureLuxHostCurrent } from "@/lib/lux/lux-host-sync"
import { applyLudusAnsibleSpeedups, applyLudusWinAsyncTimeout } from "@/lib/ludus/ludus-ansible-speedups"
import { getSettings } from "@/lib/settings/settings-store"
import { mapWithConcurrency } from "@/lib/core/concurrency"
import { TtlCache } from "@/lib/core/server-cache"

export type HostPlaybookPatch =
  | { ok: true; changed: boolean; skipped: string | null; warning?: string }
  | { ok: false; error: string }

type HostPatchOp =
  | "patch-debian11-apt"
  | "patch-chocolatey-openssh"
  | "patch-adguard-host-dns"
  | "patch-linux-reboot-wait"
  | "patch-adws-wait"
  | "patch-windows-static-ip"
  | "patch-windows-sysprep-netnative"
  | "patch-router-single-clone"

/** The installed helper predates this LUX build and rejected the operation name. */
export function luxHostMissingOperation(error: string): boolean {
  return /operation not allowed/i.test(error)
}

/**
 * Lux-host prints `status=ok|skipped` for a host playbook edit.
 * A missing playbook or a renamed task is a skip: the deploy can still
 * start. A non-zero exit means the file was not updated.
 */
export function parseHostPlaybookPatch(
  stdout: string,
  stderr: string,
  code: number,
): HostPlaybookPatch {
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
  return { ok: false, error: "lux-host did not report a host playbook patch status" }
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
  patch: HostPlaybookPatch,
  body: unknown,
  configText: string | null | undefined,
): boolean {
  return !patch.ok && rangeDeployRunsHostnameSetup(body) && deployNeedsDebian11Archive(configText)
}

async function invokeInstalledPatch(op: HostPatchOp): Promise<HostPlaybookPatch> {
  try {
    const result = await sshExec([op])
    return parseHostPlaybookPatch(result.stdout, result.stderr, result.code)
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
async function invokeBundledPatch(op: HostPatchOp): Promise<HostPlaybookPatch | null> {
  const script = loadLuxHostScriptText()
  const probe = await sshExecAccount("id -u").catch(() => null)
  const uid = probe && probe.code === 0 ? probe.stdout.trim() : ""
  const command = uid === "0" ? `bash -s -- ${op}` : `sudo -n bash -s -- ${op}`
  try {
    const result = await sshExecAccount(command, { stdin: script })
    const parsed = parseHostPlaybookPatch(result.stdout, result.stderr, result.code)
    if (!parsed.ok && /must run as root|a password is required|not allowed/i.test(parsed.error)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Host playbook edits are idempotent and report `changed=no` once applied. A
 * successful result is cached for a few minutes so repeat deploys do not pay
 * one SSH round trip per patch. The key includes the host/account and the
 * bundled helper checksum: a LUX upgrade re-checks every patch.
 */
const HOST_PATCH_CACHE_TTL_MS = 10 * 60 * 1000
const hostPatchCache = new TtlCache<HostPlaybookPatch>(HOST_PATCH_CACHE_TTL_MS, 64)

function hostPatchCacheKey(op: HostPatchOp, playbookStamp: string): string {
  const settings = getSettings()
  return [
    settings.sshHost,
    settings.sshPort || 22,
    settings.proxmoxSshUser || "root",
    op,
    bundledLuxHostSha256(),
    playbookStamp,
  ].join(":")
}

/**
 * Newest playbook/role file mtime. Directory mtime misses an in-place replace.
 * `unstamped` disables the cache so a failed read cannot skip a later edit.
 */
async function readLudusPlaybookStamp(): Promise<string> {
  try {
    const result = await sshExecAccount(
      "find /opt/ludus/ansible/playbooks /opt/ludus/ansible/roles -type f -printf '%T@\\n' | sort -n | tail -1",
    )
    const stamp = result.stdout.trim().split("\n").pop()?.trim() ?? ""
    if (result.code !== 0 || !stamp) return "unstamped"
    return stamp
  } catch {
    return "unstamped"
  }
}

/** Test/settings hook: forget cached patch state. */
export function invalidateHostPatchCache(): void {
  hostPatchCache.invalidate()
}

/**
 * Apply one playbook edit. Prefer the installed helper. If that helper does not
 * know the operation, update it once and retry, then run the script shipped
 * with this LUX build. A failure here is not fatal: the caller keeps deploying.
 */
async function applyHostPatch(
  op: HostPatchOp,
  logPrefix: string,
  playbookStamp: string,
): Promise<HostPlaybookPatch> {
  return hostPatchCache.resolve(
    hostPatchCacheKey(op, playbookStamp),
    () => applyHostPatchUncached(op, logPrefix),
    { cacheable: (patch) => patch.ok && playbookStamp !== "unstamped" },
  )
}

async function applyHostPatchUncached(op: HostPatchOp, logPrefix: string): Promise<HostPlaybookPatch> {
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
export async function ensureDebian11SecurityArchive(playbookStamp = "unstamped"): Promise<HostPlaybookPatch> {
  return applyHostPatch("patch-debian11-apt", "debian11-apt", playbookStamp)
}

/** Install Chocolatey, then reboot once, before Ludus's win_chocolatey bootstrap. */
export async function ensureChocolateyOpenSshPatch(playbookStamp = "unstamped"): Promise<HostPlaybookPatch> {
  return applyHostPatch("patch-chocolatey-openssh", "chocolatey", playbookStamp)
}

/**
 * Point AdGuardHome.yaml.j2 at 192.0.2.254. Range VMs use that resolver, and the
 * stock lists are public DNS. A Ludus update extracts a fresh template; this
 * runs again on the next deploy.
 */
export async function ensureAdguardHostDns(playbookStamp = "unstamped"): Promise<HostPlaybookPatch> {
  return applyHostPatch("patch-adguard-host-dns", "adguard-dns", playbookStamp)
}

/**
 * Ludus reboots a Linux VM, then waits only until port 22 accepts a connection.
 * The new address is already up, so that wait returns during shutdown and the
 * next task cannot create its temporary directory. Insert a wait until SSH drops.
 */
export async function ensureLinuxRebootWait(playbookStamp = "unstamped"): Promise<HostPlaybookPatch> {
  return applyHostPatch("patch-linux-reboot-wait", "linux-reboot-wait", playbookStamp)
}

/**
 * After promoting a forest, WinRM is up before Active Directory Web Services.
 * Ludus then creates OUs and the module cannot find a DC. Wait for Get-ADDomain
 * first. A later deploy finds the service already answering and continues.
 */
export async function ensureAdwsWait(playbookStamp = "unstamped"): Promise<HostPlaybookPatch> {
  return applyHostPatch("patch-adws-wait", "adws-wait", playbookStamp)
}

/**
 * Windows 8+ static addressing starts async work and waits 5 seconds for
 * Ansible's named pipe. The error names WIN_ASYNC_STARTUP_TIMEOUT; Ansible
 * reads ansible_win_async_startup_timeout. Several guests at once miss the
 * wait, the failure is ignored, and the netsh path runs only for legacy
 * Windows. Give the task 120 seconds, and run that fallback when it failed.
 * Start Sysprep and the other Windows async tasks take that wait from the
 * Ludus service environment, not from this task.
 */
export async function ensureWindowsStaticIp(playbookStamp = "unstamped"): Promise<HostPlaybookPatch> {
  return applyHostPatch("patch-windows-static-ip", "windows-static-ip", playbookStamp)
}

/**
 * Win11 23H2 sysprep dies while removing Microsoft.NET.Native.Framework.2.2
 * (shutdown already in progress). Drop that package only when it is installed,
 * then reboot that VM before generalize. A guest without it is unchanged.
 */
export async function ensureWindowsSysprepNetNative(playbookStamp = "unstamped"): Promise<HostPlaybookPatch> {
  return applyHostPatch("patch-windows-sysprep-netnative", "windows-sysprep-netnative", playbookStamp)
}

/**
 * A network deploy runs the router clone task again. Proxmox allows a second
 * VM with the same name, and the VLAN lookup then prints every VMID. Skip the
 * clone when one already exists, and keep a single VMID in the lookups.
 */
export async function ensureRouterSingleClone(playbookStamp = "unstamped"): Promise<HostPlaybookPatch> {
  return applyHostPatch("patch-router-single-clone", "router-clone", playbookStamp)
}

/**
 * Apply the host playbook edits a range deploy needs. A missed edit does not
 * stop the deploy: an older lux-host rejects the operation name, and the stock
 * Ludus plays still run.
 */
export async function ensureRangeDeployHostPatches(
  body: unknown,
  opts?: { configText?: string | null },
): Promise<HostPlaybookPatch> {
  const settings = getSettings()
  const playbookStamp = await readLudusPlaybookStamp()
  type PatchTask = { id: string; run: () => Promise<HostPlaybookPatch> }
  const tasks: PatchTask[] = [
    { id: "apt", run: () => ensureDebian11SecurityArchive(playbookStamp) },
    { id: "choco", run: () => ensureChocolateyOpenSshPatch(playbookStamp) },
    { id: "rebootWait", run: () => ensureLinuxRebootWait(playbookStamp) },
    { id: "adwsWait", run: () => ensureAdwsWait(playbookStamp) },
    { id: "windowsStaticIp", run: () => ensureWindowsStaticIp(playbookStamp) },
    { id: "windowsSysprep", run: () => ensureWindowsSysprepNetNative(playbookStamp) },
    { id: "routerClone", run: () => ensureRouterSingleClone(playbookStamp) },
  ]
  if (settings.useLudusHostDns) tasks.push({ id: "dns", run: () => ensureAdguardHostDns(playbookStamp) })

  // The helper operations are idempotent and touch different playbooks. Run
  // them with a small worker pool instead of serial SSH round trips.
  const results = await mapWithConcurrency(tasks, 3, (task) => task.run())
  const byId = new Map(tasks.map((task, i) => [task.id, results[i]!]))
  const apt = byId.get("apt")!
  const choco = byId.get("choco")!
  const dns = byId.get("dns") ?? ({ ok: true, changed: false, skipped: null } satisfies HostPlaybookPatch)
  const rebootWait = byId.get("rebootWait")!
  const adwsWait = byId.get("adwsWait")!
  const windowsStaticIp = byId.get("windowsStaticIp")!
  const windowsSysprep = byId.get("windowsSysprep")!
  const routerClone = byId.get("routerClone")!
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
  if (!rebootWait.ok) {
    warnings.push(`Linux reboot wait edit skipped (${rebootWait.error}). Deploy is continuing.`)
  }
  if (!adwsWait.ok) {
    warnings.push(`Active Directory Web Services wait edit skipped (${adwsWait.error}). Deploy is continuing.`)
  }
  if (!windowsStaticIp.ok) {
    warnings.push(`Windows static IP edit skipped (${windowsStaticIp.error}). Deploy is continuing.`)
  }
  if (!windowsSysprep.ok) {
    warnings.push(`Windows sysprep package edit skipped (${windowsSysprep.error}). Deploy is continuing.`)
  }
  if (!routerClone.ok) {
    warnings.push(`Router clone edit skipped (${routerClone.error}). Deploy is continuing.`)
  }
  try {
    const timeout = await applyLudusWinAsyncTimeout()
    if (!timeout.ok) {
      warnings.push(
        `Windows async startup timeout skipped (${timeout.detail ?? "failed"}). Deploy is continuing.`,
      )
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(`[win-async-timeout] ${detail}`)
    warnings.push(`Windows async startup timeout skipped (${detail}). Deploy is continuing.`)
  }
  try {
    const speedups = await applyLudusAnsibleSpeedups(getSettings().ludusAnsibleSpeedups)
    if (!speedups.ok) {
      warnings.push(
        `Ansible speedups drop-in skipped (${speedups.detail ?? "failed"}). Deploy is continuing.`,
      )
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(`[ansible-speedups] ${detail}`)
    warnings.push(`Ansible speedups drop-in skipped (${detail}). Deploy is continuing.`)
  }
  return {
    ok: true,
    changed:
      (apt.ok && apt.changed) ||
      (choco.ok && choco.changed) ||
      (dns.ok && dns.changed) ||
      (rebootWait.ok && rebootWait.changed) ||
      (adwsWait.ok && adwsWait.changed) ||
      (windowsStaticIp.ok && windowsStaticIp.changed) ||
      (windowsSysprep.ok && windowsSysprep.changed) ||
      (routerClone.ok && routerClone.changed),
    skipped: null,
    warning: warnings.length > 0 ? warnings.join(" ") : undefined,
  }
}
