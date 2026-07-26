/**
 * Proxmox helpers for Ludus testing-mode EFI / snapshot safety:
 * - Before testing **start**: enroll UEFI 2023 certs (`ms-cert=2023k`) on EFI disks
 *   that lack them, then snapshot — otherwise Proxmox rollback fails later
 *   (see badsectorlabs/ludus-source-bsl#3).
 * - Manual rescue: rollback / enroll shells (do NOT pre-rollback before Ludus stop).
 */

import { ludusRequest } from "@/lib/ludus-client"
import {
  isLudusRangeRouterVmName,
  isLudusVmRunning,
  snapshotTargetProxmoxIdsExcludingRouter,
} from "@/lib/ludus-range-router-vm"
import { sshExec } from "@/lib/proxmox-ssh"
import { requireProxmoxSsh, type ProxmoxSshCredentials } from "@/lib/root-ssh-auth"
import {
  clearTestingStopEfiCache,
  fingerprintRangeVmids,
  resolveTestingStopEfiCache,
  setTestingStopEfiCache,
} from "@/lib/testing-stop-efi-cache"
import type { RangeObject, VMObject } from "@/lib/types"

/** Snapshot name Ludus creates on testing start (Ansible `snapshot-management.yml`). */
export const LUDUS_TESTING_CLEAN_SNAPSHOT = "ludus_automated_clean_snapshot"

export type EfiEnrollCandidate = {
  vmid: number
  name: string
  node: string
}

export type TestingStopPreflightPreview = {
  ok: boolean
  error?: string
  /** VMs that need power-off + `qm enroll-efi-keys` before testing-start snapshot. */
  candidates: EfiEnrollCandidate[]
  /** True when result came from SQLite cache (same range VM set). */
  cached?: boolean
  vmFingerprint?: string
}

export type TestingStopPreflightResult = {
  attempted: boolean
  skippedReason?: string
  /** VMIDs that were targeted. */
  vmids: number[]
  enrolled: number[]
  rolledBack: number[]
  errors: string[]
}

/** Result of EFI enroll before Ludus `PUT /testing/start`. */
export type TestingStartEfiEnrollResult = {
  attempted: boolean
  /** When true, caller must abort testing_start (do not call Ludus). */
  fatal: boolean
  skippedReason?: string
  vmids: number[]
  enrolled: number[]
  errors: string[]
  candidates: EfiEnrollCandidate[]
}

type ClusterVmResource = {
  vmid?: number | string
  node?: string
  type?: string
}

/** Parse `pvesh get /cluster/resources --type vm` JSON into vmid → node. */
export function parseClusterVmidNodeMap(jsonText: string): Map<number, string> {
  const map = new Map<number, string>()
  let data: unknown
  try {
    data = JSON.parse(jsonText)
  } catch {
    return map
  }
  if (!Array.isArray(data)) return map
  for (const raw of data) {
    const item = raw as ClusterVmResource
    if (item.type && item.type !== "qemu") continue
    const id = typeof item.vmid === "number" ? item.vmid : Number(item.vmid)
    if (!Number.isFinite(id) || !item.node) continue
    map.set(id, String(item.node))
  }
  return map
}

/**
 * True when `qm config` shows an EFI disk that still lacks Microsoft 2023 UEFI certs.
 * Proxmox warns: EFI disk without 'ms-cert=2023k'.
 */
export function efiDiskNeedsMsCert2023(qmConfig: string): boolean {
  if (!qmConfig.trim()) return false
  const hasEfi = /^efidisk\d*:/im.test(qmConfig)
  if (!hasEfi) return false
  // Already enrolled — any efidisk line containing ms-cert=2023k
  if (/^efidisk\d*:.*ms-cert=2023k/im.test(qmConfig)) return false
  if (/\bms-cert=2023k\b/i.test(qmConfig)) return false
  return true
}

function assertSafeSnapname(snapname: string): string {
  if (!/^[A-Za-z0-9_.:-]+$/.test(snapname)) {
    throw new Error(`invalid snapname: ${snapname}`)
  }
  return snapname
}

function assertSafeNode(node: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(node)) {
    throw new Error(`invalid node: ${node}`)
  }
  return node
}

function assertSafeVmid(vmid: number): number {
  const id = Math.trunc(vmid)
  if (!Number.isFinite(id) || id <= 0) throw new Error(`invalid vmid: ${vmid}`)
  return id
}

/** Shell: dump qm config for one VM (read-only; no stop). */
export function buildQmConfigShell(vmid: number): string {
  const id = assertSafeVmid(vmid)
  return `qm config ${id} 2>/dev/null || true`
}

/**
 * Manual/rescue: stop + rollback testing snapshot only.
 * Do NOT call before Ludus — pre-rollback makes `proxmox_snap` return `changed=false`.
 * Do NOT enroll here — `qm rollback` restores the old EFI disk and wipes `ms-cert=2023k`.
 */
export function buildTestingStopVmRollbackShell(
  vmid: number,
  node: string,
  snapname: string,
): string {
  const id = assertSafeVmid(vmid)
  const n = assertSafeNode(node)
  const snap = assertSafeSnapname(snapname)
  const snapQ = JSON.stringify(snap)

  return [
    `echo "[lux-testing-stop] rollback prep vmid=${id} node=${n} snap=${snap}"`,
    `qm shutdown ${id} --timeout 90 --forceStop 1 2>/dev/null || pvesh create /nodes/${n}/qemu/${id}/status/stop --skiplock 1 2>/dev/null || true`,
    `qm listsnapshot ${id} 2>/dev/null | grep -qF ${snapQ} && echo "[lux-testing-stop] qm rollback ${id} ${snap}" && qm rollback ${id} ${snapQ} || echo "[lux-testing-stop] snapshot ${snap} missing on ${id}"`,
    `echo "[lux-testing-stop] rollback prep done ${id}"`,
  ].join("; ")
}

/**
 * Enroll UEFI 2023 certs (VM must be stopped). Leaves VM stopped.
 * Prefer {@link buildTestingStartEfiEnrollShell} before testing start (optional restart).
 */
export function buildTestingStopVmEnrollShell(vmid: number, node: string): string {
  const id = assertSafeVmid(vmid)
  const n = assertSafeNode(node)

  return [
    `echo "[lux-testing-efi] enroll vmid=${id} node=${n}"`,
    `qm shutdown ${id} --timeout 90 --forceStop 1 2>/dev/null || pvesh create /nodes/${n}/qemu/${id}/status/stop --skiplock 1 2>/dev/null || true`,
    `echo "[lux-testing-efi] enroll-efi-keys ${id}"`,
    `qm enroll-efi-keys ${id}`,
    `qm config ${id} 2>/dev/null | grep -qF ms-cert=2023k && echo "[lux-testing-efi] ms-cert=2023k ok ${id}" || echo "[lux-testing-efi] ms-cert=2023k MISSING ${id}"`,
    `echo "[lux-testing-efi] enroll done ${id}"`,
  ].join("; ")
}

/**
 * Before testing-start snapshot: shutdown → `qm enroll-efi-keys` → verify → optional start.
 * Avoid `$vars` / `$(...)` / awk `$N` — `sshExec` wraps with `bash -l -c "..."`.
 */
export function buildTestingStartEfiEnrollShell(
  vmid: number,
  node: string,
  opts: { restart: boolean },
): string {
  const id = assertSafeVmid(vmid)
  const n = assertSafeNode(node)
  const parts = [
    `echo "[lux-testing-start] enroll vmid=${id} node=${n} restart=${opts.restart ? "1" : "0"}"`,
    `qm shutdown ${id} --timeout 90 --forceStop 1 2>/dev/null || pvesh create /nodes/${n}/qemu/${id}/status/stop --skiplock 1 2>/dev/null || true`,
    `echo "[lux-testing-start] enroll-efi-keys ${id}"`,
    `qm enroll-efi-keys ${id}`,
    `qm config ${id} 2>/dev/null | grep -qF ms-cert=2023k && echo "[lux-testing-start] ms-cert=2023k ok ${id}" || echo "[lux-testing-start] ms-cert=2023k MISSING ${id}"`,
  ]
  if (opts.restart) {
    parts.push(`qm start ${id} 2>/dev/null || pvesh create /nodes/${n}/qemu/${id}/status/start 2>/dev/null || true`)
    parts.push(`echo "[lux-testing-start] restarted ${id}"`)
  }
  parts.push(`echo "[lux-testing-start] enroll done ${id}"`)
  return parts.join("; ")
}

/** @deprecated Use buildTestingStopVmRollbackShell + buildTestingStopVmEnrollShell */
export function buildTestingStopVmPrepShell(
  vmid: number,
  node: string,
  snapname: string,
): string {
  return buildTestingStopVmRollbackShell(vmid, node, snapname)
}

async function sshRun(creds: ProxmoxSshCredentials, command: string): Promise<string> {
  return sshExec(creds.sshHost, creds.sshPort, creds.sshUser, creds.sshPass, command)
}

function proxmoxIdForVm(vm: VMObject): number | null {
  const raw = vm.proxmoxID ?? vm.ID
  const id = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(id) ? id : null
}

function vmLabel(vm: VMObject): string {
  return (vm.name || vm.vmName || `VM ${proxmoxIdForVm(vm) ?? "?"}`).trim()
}

async function fetchRangeVms(
  rangeId: string,
  apiKey: string,
  userOverride?: string,
): Promise<VMObject[]> {
  const result = await ludusRequest<RangeObject>(
    `/range?rangeID=${encodeURIComponent(rangeId)}`,
    { apiKey, userOverride },
  )
  return result.data?.VMs ?? result.data?.vms ?? []
}

async function resolveVmidNodes(
  creds: ProxmoxSshCredentials,
  vmids: number[],
): Promise<Map<number, string>> {
  const json = await sshRun(creds, "pvesh get /cluster/resources --type vm --output-format json")
  const map = parseClusterVmidNodeMap(json)
  const missing = vmids.filter((id) => !map.has(id))
  if (missing.length === 0) return map

  const nodesJson = await sshRun(creds, "pvesh get /nodes --output-format json")
  let fallback = "localhost"
  try {
    const nodes = JSON.parse(nodesJson) as Array<{ node?: string }>
    if (nodes[0]?.node) fallback = nodes[0].node
  } catch {
    /* keep localhost */
  }
  for (const id of missing) map.set(id, fallback)
  return map
}

/** One entry per Proxmox VMID (Ludus may list the same VM twice). */
export function dedupeEfiEnrollCandidates(
  candidates: EfiEnrollCandidate[],
): EfiEnrollCandidate[] {
  const byId = new Map<number, EfiEnrollCandidate>()
  for (const c of candidates) {
    if (!Number.isFinite(c.vmid) || c.vmid <= 0) continue
    if (!byId.has(c.vmid)) byId.set(c.vmid, c)
  }
  return [...byId.values()].sort((a, b) => a.vmid - b.vmid)
}

/**
 * Probe range VMs over SSH; return those whose EFI disk needs `ms-cert=2023k`.
 * Read-only — does not stop VMs. Results cached in SQLite until the range VM set changes.
 */
export async function listTestingStopEfiEnrollCandidates(opts: {
  rangeId: string
  apiKey: string
  userOverride?: string
  /** Skip SQLite cache (e.g. after enroll). */
  forceRefresh?: boolean
}): Promise<TestingStopPreflightPreview> {
  let vms: VMObject[]
  try {
    vms = await fetchRangeVms(opts.rangeId, opts.apiKey, opts.userOverride)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      candidates: [],
    }
  }

  const vmids = snapshotTargetProxmoxIdsExcludingRouter(vms)
  const vmFingerprint = fingerprintRangeVmids(vmids)

  if (!opts.forceRefresh) {
    const cached = resolveTestingStopEfiCache(opts.rangeId, vmFingerprint)
    if (cached) {
      return {
        ok: true,
        candidates: dedupeEfiEnrollCandidates(cached.candidates),
        cached: true,
        vmFingerprint: cached.vmFingerprint,
      }
    }
  }

  // Empty VM list from Ludus is usually a transient API glitch — do not wipe cache.
  if (vmids.length === 0 && !opts.forceRefresh) {
    const cached = resolveTestingStopEfiCache(opts.rangeId, "")
    if (cached) {
      return {
        ok: true,
        candidates: dedupeEfiEnrollCandidates(cached.candidates),
        cached: true,
        vmFingerprint: cached.vmFingerprint,
      }
    }
  }

  const ssh = requireProxmoxSsh()
  if (!ssh.ok) {
    // Prefer last good cache over failing the notice open
    const cached = resolveTestingStopEfiCache(opts.rangeId, vmFingerprint)
    if (cached) {
      return {
        ok: true,
        candidates: dedupeEfiEnrollCandidates(cached.candidates),
        cached: true,
        vmFingerprint: cached.vmFingerprint,
      }
    }
    return { ok: false, error: ssh.error, candidates: [], vmFingerprint }
  }

  // Dedupe Ludus VM list by proxmox ID before probing
  const targetsById = new Map<number, VMObject>()
  for (const vm of vms) {
    const label = vm.name || vm.vmName || ""
    if (isLudusRangeRouterVmName(label)) continue
    const id = proxmoxIdForVm(vm)
    if (id == null) continue
    if (!targetsById.has(id)) targetsById.set(id, vm)
  }

  if (targetsById.size === 0) {
    // Do not overwrite a prior good cache with [] (empty Ludus VM list glitch).
    const cached = resolveTestingStopEfiCache(opts.rangeId, "")
    if (cached && cached.candidates.length > 0) {
      return {
        ok: true,
        candidates: dedupeEfiEnrollCandidates(cached.candidates),
        cached: true,
        vmFingerprint: cached.vmFingerprint,
      }
    }
    setTestingStopEfiCache(opts.rangeId, vmFingerprint, [])
    return { ok: true, candidates: [], cached: false, vmFingerprint }
  }

  let nodeMap: Map<number, string>
  try {
    nodeMap = await resolveVmidNodes(ssh.creds, [...targetsById.keys()])
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      candidates: [],
      vmFingerprint,
    }
  }

  const candidates: EfiEnrollCandidate[] = []
  for (const [vmid, vm] of targetsById) {
    try {
      const cfg = await sshRun(ssh.creds, buildQmConfigShell(vmid))
      if (!efiDiskNeedsMsCert2023(cfg)) continue
      candidates.push({
        vmid,
        name: vmLabel(vm),
        node: nodeMap.get(vmid) || "localhost",
      })
    } catch (err) {
      console.warn(
        `[testing-efi-preflight] qm config ${vmid} failed:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  const unique = dedupeEfiEnrollCandidates(candidates)
  setTestingStopEfiCache(opts.rangeId, vmFingerprint, unique)
  return { ok: true, candidates: unique, cached: false, vmFingerprint }
}

async function loadEfiCandidates(opts: {
  rangeId: string
  apiKey: string
  userOverride?: string
}): Promise<TestingStopPreflightPreview> {
  return listTestingStopEfiEnrollCandidates({
    ...opts,
    forceRefresh: true,
  })
}

/**
 * Before Ludus testing start: enroll `ms-cert=2023k` on needy EFI disks so the
 * clean snapshot includes updated UEFI certs (required for later rollback).
 * On verify failure sets `fatal: true` — caller must not call Ludus start.
 */
export async function runTestingStartEfiEnrollPreflight(opts: {
  rangeId: string
  apiKey: string
  userOverride?: string
}): Promise<TestingStartEfiEnrollResult> {
  const empty = (extra: Partial<TestingStartEfiEnrollResult> = {}): TestingStartEfiEnrollResult => ({
    attempted: false,
    fatal: false,
    vmids: [],
    enrolled: [],
    errors: [],
    candidates: [],
    ...extra,
  })

  let vms: VMObject[]
  try {
    vms = await fetchRangeVms(opts.rangeId, opts.apiKey, opts.userOverride)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return empty({ fatal: true, skippedReason: msg, errors: [msg] })
  }

  const preview = await listTestingStopEfiEnrollCandidates({
    rangeId: opts.rangeId,
    apiKey: opts.apiKey,
    userOverride: opts.userOverride,
    forceRefresh: true,
  })

  if (!preview.ok) {
    // No candidates known (e.g. Proxmox SSH unset) — do not block start.
    // When candidates exist we require SSH below and abort on enroll failure.
    const msg = preview.error || "EFI disk probe failed"
    console.warn(`[testing-start-efi] skip for ${opts.rangeId}: ${msg}`)
    return empty({ skippedReason: msg, errors: [msg] })
  }

  const candidates = dedupeEfiEnrollCandidates(preview.candidates)
  if (candidates.length === 0) {
    return empty({ skippedReason: "no VMs need EFI enroll", candidates })
  }

  const ssh = requireProxmoxSsh()
  if (!ssh.ok) {
    return empty({
      fatal: true,
      skippedReason: ssh.error,
      errors: [ssh.error],
      candidates,
      vmids: candidates.map((c) => c.vmid),
    })
  }

  const runningById = new Map<number, boolean>()
  for (const vm of vms) {
    const id = proxmoxIdForVm(vm)
    if (id == null) continue
    if (!runningById.has(id)) runningById.set(id, isLudusVmRunning(vm))
  }

  const enrolled: number[] = []
  const errors: string[] = []
  const vmids = candidates.map((c) => c.vmid)

  for (const c of candidates) {
    const restart = runningById.get(c.vmid) === true
    try {
      const script = buildTestingStartEfiEnrollShell(c.vmid, c.node, { restart })
      const out = await sshRun(ssh.creds, script)
      if (/ms-cert=2023k ok/i.test(out)) {
        enrolled.push(c.vmid)
        console.log(
          `[testing-start-efi] enroll vmid=${c.vmid} (${c.name}) ok restart=${restart ? 1 : 0}`,
        )
      } else {
        const msg = `vmid ${c.vmid}: enroll ran but ms-cert=2023k not in qm config`
        console.warn(`[testing-start-efi] ${msg}`)
        errors.push(msg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[testing-start-efi] enroll vmid=${c.vmid} failed: ${msg}`)
      errors.push(`vmid ${c.vmid}: ${msg}`)
    }
  }

  if (enrolled.length > 0) {
    clearTestingStopEfiCache(opts.rangeId)
  }

  const fatal = errors.length > 0 || enrolled.length < candidates.length
  return {
    attempted: true,
    fatal,
    vmids,
    enrolled,
    errors:
      fatal && errors.length === 0
        ? [`EFI enroll incomplete: ${enrolled.length}/${candidates.length} succeeded`]
        : errors,
    candidates,
  }
}

/**
 * Manual/rescue only: stop + `qm rollback` for EFI-needy VMs.
 * Do NOT call before Ludus testing stop — pre-rollback makes `proxmox_snap`
 * return `changed=false`. Prefer enroll-before-snapshot via
 * {@link runTestingStartEfiEnrollPreflight}.
 */
export async function runTestingStopProxmoxPreflight(opts: {
  rangeId: string
  apiKey: string
  userOverride?: string
  snapname?: string
}): Promise<TestingStopPreflightResult> {
  const snapname = opts.snapname ?? LUDUS_TESTING_CLEAN_SNAPSHOT
  const preview = await loadEfiCandidates(opts)

  if (!preview.ok) {
    console.warn(
      `[testing-stop-preflight] skip rollback prep for ${opts.rangeId}: ${preview.error}`,
    )
    return {
      attempted: false,
      skippedReason: preview.error,
      vmids: [],
      enrolled: [],
      rolledBack: [],
      errors: preview.error ? [preview.error] : [],
    }
  }

  if (preview.candidates.length === 0) {
    return {
      attempted: false,
      skippedReason: "no VMs need EFI enroll",
      vmids: [],
      enrolled: [],
      rolledBack: [],
      errors: [],
    }
  }

  const ssh = requireProxmoxSsh()
  if (!ssh.ok) {
    return {
      attempted: false,
      skippedReason: ssh.error,
      vmids: [],
      enrolled: [],
      rolledBack: [],
      errors: [],
    }
  }

  const rolledBack: number[] = []
  const errors: string[] = []
  const vmids = preview.candidates.map((c) => c.vmid)

  for (const c of preview.candidates) {
    try {
      const script = buildTestingStopVmRollbackShell(c.vmid, c.node, snapname)
      const out = await sshRun(ssh.creds, script)
      if (/qm rollback/i.test(out) && !/snapshot .+ missing/i.test(out)) {
        rolledBack.push(c.vmid)
      }
      console.log(`[testing-stop-preflight] rollback vmid=${c.vmid} (${c.name}) ok`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[testing-stop-preflight] rollback vmid=${c.vmid} failed: ${msg}`)
      errors.push(`vmid ${c.vmid}: ${msg}`)
    }
  }

  return { attempted: true, vmids, enrolled: [], rolledBack, errors }
}

/**
 * Manual/rescue: `qm enroll-efi-keys` after a snapshot rollback wiped certs.
 * Prefer {@link runTestingStartEfiEnrollPreflight} before the next testing start.
 */
export async function runTestingStopProxmoxPostflight(opts: {
  rangeId: string
  apiKey: string
  userOverride?: string
}): Promise<TestingStopPreflightResult> {
  const preview = await loadEfiCandidates(opts)

  if (!preview.ok) {
    return {
      attempted: false,
      skippedReason: preview.error,
      vmids: [],
      enrolled: [],
      rolledBack: [],
      errors: preview.error ? [preview.error] : [],
    }
  }

  if (preview.candidates.length === 0) {
    return {
      attempted: false,
      skippedReason: "no VMs need EFI enroll",
      vmids: [],
      enrolled: [],
      rolledBack: [],
      errors: [],
    }
  }

  const ssh = requireProxmoxSsh()
  if (!ssh.ok) {
    return {
      attempted: false,
      skippedReason: ssh.error,
      vmids: [],
      enrolled: [],
      rolledBack: [],
      errors: [],
    }
  }

  const enrolled: number[] = []
  const errors: string[] = []
  const vmids = preview.candidates.map((c) => c.vmid)

  for (const c of preview.candidates) {
    try {
      const script = buildTestingStopVmEnrollShell(c.vmid, c.node)
      const out = await sshRun(ssh.creds, script)
      if (/ms-cert=2023k ok/i.test(out)) {
        enrolled.push(c.vmid)
      } else if (/enroll-efi-keys/i.test(out)) {
        errors.push(`vmid ${c.vmid}: enroll ran but ms-cert=2023k not in qm config`)
      }
      console.log(`[testing-stop-postflight] enroll vmid=${c.vmid} (${c.name})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[testing-stop-postflight] enroll vmid=${c.vmid} failed: ${msg}`)
      errors.push(`vmid ${c.vmid}: ${msg}`)
    }
  }

  if (enrolled.length > 0) {
    clearTestingStopEfiCache(opts.rangeId)
  }

  return { attempted: true, vmids, enrolled, rolledBack: [], errors }
}

/** Confirm / alert copy when some VMs will be powered off for EFI enroll before snapshot. */
export function formatTestingStopEfiShutdownNotice(candidates: EfiEnrollCandidate[]): string {
  const unique = dedupeEfiEnrollCandidates(candidates)
  if (unique.length === 0) return ""
  const labels = unique.map((c) => `${c.name} (${c.vmid})`)
  const list =
    labels.length <= 3
      ? labels.join(", ")
      : `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more`
  return (
    `These VM${unique.length === 1 ? "" : "s"} will power off briefly ` +
    `to enroll UEFI 2023 certificates (required for snapshot rollback): ${list}. ` +
    `Then testing snapshots continue.`
  )
}
