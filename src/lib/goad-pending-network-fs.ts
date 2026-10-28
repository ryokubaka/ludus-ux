/**
 * Filesystem helpers for DATA_DIR/pending-network/{instanceId}.json
 * (shared by API route and server-side post-GOAD workflow).
 */

import fs from "fs"
import path from "path"

function pendingNetworkDir(): string {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data")
  return path.join(dataDir, "pending-network")
}

/** Instance ids are a single path segment. They never contain separators or "..". */
export const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export class InvalidInstanceIdError extends Error {
  constructor() {
    super("Invalid instance id")
    this.name = "InvalidInstanceIdError"
  }
}

export function assertSafeInstanceId(instanceId: string): string {
  const id = instanceId.trim()
  if (!INSTANCE_ID_PATTERN.test(id)) {
    throw new InvalidInstanceIdError()
  }
  return id
}

export function pendingNetworkJsonPath(instanceId: string): string {
  const id = assertSafeInstanceId(instanceId)
  const root = path.resolve(pendingNetworkDir())
  const filePath = path.resolve(root, `${id}.json`)
  if (filePath !== path.join(root, `${id}.json`)) {
    throw new InvalidInstanceIdError()
  }
  return filePath
}

export type PendingNetworkEnvelope = {
  snapshot: Record<string, unknown>
  savedAt?: number
  username?: string
}

export function readPendingNetworkEnvelope(instanceId: string): PendingNetworkEnvelope | null {
  const filePath = pendingNetworkJsonPath(instanceId)
  if (!fs.existsSync(filePath)) return null
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      snapshot?: unknown
      savedAt?: number
      username?: unknown
    }
    const snap = data?.snapshot
    if (!snap || typeof snap !== "object" || Array.isArray(snap)) return null
    return {
      snapshot: snap as Record<string, unknown>,
      savedAt: typeof data.savedAt === "number" ? data.savedAt : undefined,
      username: typeof data.username === "string" ? data.username : undefined,
    }
  } catch (err) {
    if (err instanceof InvalidInstanceIdError) throw err
    return null
  }
}

/** Non-admins may read only their own snapshot. A file with no owner is admin-only. */
export function canAccessPendingNetwork(
  envelope: PendingNetworkEnvelope,
  username: string,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true
  const owner = envelope.username?.trim() ?? ""
  if (!owner) return false
  return owner.toLowerCase() === username.trim().toLowerCase()
}

/**
 * Write a pending-network snapshot to disk from the deploy handoff route.
 * The file format matches what POST .../pending-network writes so that
 * readUnlinkPendingNetworkSnapshot can consume it regardless of which path
 * created it.
 */
export function writePendingNetworkSnapshot(
  instanceId: string,
  snapshotJson: string,
  username: string,
): void {
  const filePath = pendingNetworkJsonPath(instanceId)
  fs.mkdirSync(pendingNetworkDir(), { recursive: true })
  // codeql[js/http-to-file-access]
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      snapshot: JSON.parse(snapshotJson),
      savedAt: Date.now(),
      username,
    }),
    "utf8",
  )
}

/**
 * Read wizard snapshot from disk and delete the file (single consumer).
 * Trusted server workflow only. HTTP routes must check the owner first.
 * @returns snapshot object, or null if missing / invalid / unreadable
 */
export function readUnlinkPendingNetworkSnapshot(instanceId: string): Record<string, unknown> | null {
  const envelope = readPendingNetworkEnvelope(instanceId)
  const filePath = pendingNetworkJsonPath(instanceId)
  if (!envelope) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch {
        /* ignore */
      }
    }
    return null
  }
  try {
    fs.unlinkSync(filePath)
  } catch {
    /* the reader still returns the snapshot; a second consumer sees a miss */
  }
  return envelope.snapshot
}
