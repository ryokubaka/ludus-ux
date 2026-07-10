/**
 * Persist EFI enroll preview per range until the VM set gains new VMIDs.
 */

import { getDb } from "./db"
import type { EfiEnrollCandidate } from "./proxmox-testing-stop-preflight"

let _schemaReady = false

function ensureTable() {
  if (_schemaReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS testing_stop_efi_cache (
      rangeId       TEXT PRIMARY KEY,
      vmFingerprint TEXT NOT NULL,
      candidatesJson TEXT NOT NULL,
      checkedAt     INTEGER NOT NULL
    );
  `)
  _schemaReady = true
}

/** Sorted unique VMIDs joined — changes when VMs are added/removed. */
export function fingerprintRangeVmids(vmids: number[]): string {
  const uniq = [...new Set(vmids.filter((id) => Number.isFinite(id) && id > 0))]
  uniq.sort((a, b) => a - b)
  return uniq.join(",")
}

export function parseVmFingerprint(fp: string): number[] {
  if (!fp.trim()) return []
  return fp
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0)
}

/** True when `next` includes any VMID not in `prev` (range grew). */
export function vmFingerprintGainedVms(prevFp: string, nextFp: string): boolean {
  const prev = new Set(parseVmFingerprint(prevFp))
  const next = parseVmFingerprint(nextFp)
  if (next.length === 0) return false
  return next.some((id) => !prev.has(id))
}

type CacheRow = {
  vmFingerprint: string
  candidatesJson: string
  checkedAt: number
}

function parseCandidates(json: string): EfiEnrollCandidate[] | null {
  try {
    const parsed = JSON.parse(json) as EfiEnrollCandidate[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function getTestingStopEfiCache(
  rangeId: string,
  vmFingerprint: string,
): EfiEnrollCandidate[] | null {
  ensureTable()
  const row = getDb()
    .prepare(
      `SELECT candidatesJson FROM testing_stop_efi_cache
       WHERE rangeId = ? AND vmFingerprint = ?`,
    )
    .get(rangeId, vmFingerprint) as { candidatesJson: string } | undefined
  if (!row) return null
  return parseCandidates(row.candidatesJson)
}

/** Latest cache row for range (any fingerprint) — used when Ludus VM list is empty/glitchy. */
export function getTestingStopEfiCacheRow(rangeId: string): {
  vmFingerprint: string
  candidates: EfiEnrollCandidate[]
  checkedAt: number
} | null {
  ensureTable()
  const row = getDb()
    .prepare(
      `SELECT vmFingerprint, candidatesJson, checkedAt FROM testing_stop_efi_cache
       WHERE rangeId = ?`,
    )
    .get(rangeId) as CacheRow | undefined
  if (!row) return null
  const candidates = parseCandidates(row.candidatesJson)
  if (!candidates) return null
  return {
    vmFingerprint: row.vmFingerprint,
    candidates,
    checkedAt: row.checkedAt,
  }
}

/**
 * Resolve cache for a range given the current VM fingerprint.
 * - Exact fingerprint match → hit
 * - Empty current fingerprint (API glitch) → keep last row
 * - Current fingerprint only lost VMs (not gained) → keep last row
 * - Current fingerprint gained VMs → miss (must re-probe)
 */
export function resolveTestingStopEfiCache(
  rangeId: string,
  vmFingerprint: string,
): { candidates: EfiEnrollCandidate[]; vmFingerprint: string; staleFingerprint: boolean } | null {
  const exact = getTestingStopEfiCache(rangeId, vmFingerprint)
  if (exact) {
    return { candidates: exact, vmFingerprint, staleFingerprint: false }
  }

  const row = getTestingStopEfiCacheRow(rangeId)
  if (!row) return null

  if (!vmFingerprint.trim()) {
    return {
      candidates: row.candidates,
      vmFingerprint: row.vmFingerprint,
      staleFingerprint: true,
    }
  }

  if (!vmFingerprintGainedVms(row.vmFingerprint, vmFingerprint)) {
    // Same or smaller set — keep cached EFI result; update stored fingerprint if shrunk
    if (vmFingerprint !== row.vmFingerprint) {
      setTestingStopEfiCache(rangeId, vmFingerprint, row.candidates)
    }
    return {
      candidates: row.candidates,
      vmFingerprint,
      staleFingerprint: false,
    }
  }

  return null
}

export function setTestingStopEfiCache(
  rangeId: string,
  vmFingerprint: string,
  candidates: EfiEnrollCandidate[],
): void {
  ensureTable()
  getDb()
    .prepare(
      `INSERT INTO testing_stop_efi_cache (rangeId, vmFingerprint, candidatesJson, checkedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(rangeId) DO UPDATE SET
         vmFingerprint = excluded.vmFingerprint,
         candidatesJson = excluded.candidatesJson,
         checkedAt = excluded.checkedAt`,
    )
    .run(rangeId, vmFingerprint, JSON.stringify(candidates), Date.now())
}

/** Drop cache after enroll or when forcing a re-probe. */
export function clearTestingStopEfiCache(rangeId: string): void {
  ensureTable()
  getDb().prepare(`DELETE FROM testing_stop_efi_cache WHERE rangeId = ?`).run(rangeId)
}
