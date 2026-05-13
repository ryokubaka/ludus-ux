/**
 * Filesystem helpers for DATA_DIR/pending-network/{instanceId}.json
 * (shared by API route and server-side post-GOAD workflow).
 */

import fs from "fs"
import path from "path"
import { DATA_DIR } from "@/lib/db"

export const PENDING_NETWORK_DIR = path.join(DATA_DIR, "pending-network")

export function pendingNetworkJsonPath(instanceId: string): string {
  return path.join(PENDING_NETWORK_DIR, `${instanceId}.json`)
}

/**
 * Write a pending-network snapshot to disk from the deploy handoff route.
 * The file format matches what POST .../pending-network writes so that
 * readUnlinkPendingNetworkSnapshot can consume it regardless of which path
 * created it.
 */
export function writePendingNetworkSnapshot(instanceId: string, snapshotJson: string): void {
  try {
    fs.mkdirSync(PENDING_NETWORK_DIR, { recursive: true })
    const filePath = pendingNetworkJsonPath(instanceId)
    // Wrap in the same envelope the pending-network API route uses.
    fs.writeFileSync(filePath, JSON.stringify({ snapshot: JSON.parse(snapshotJson) }), "utf8")
  } catch {
    // Non-fatal — caller will fall back to the inline snapshot path.
  }
}

/**
 * Read wizard snapshot from disk and delete the file (single consumer).
 * @returns snapshot object, or null if missing / invalid / unreadable
 */
export function readUnlinkPendingNetworkSnapshot(instanceId: string): Record<string, unknown> | null {
  const filePath = pendingNetworkJsonPath(instanceId)
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const data = JSON.parse(raw) as { snapshot?: unknown }
    fs.unlinkSync(filePath)
    const snap = data?.snapshot
    if (snap && typeof snap === "object" && !Array.isArray(snap)) {
      return snap as Record<string, unknown>
    }
    return null
  } catch {
    try {
      fs.unlinkSync(filePath)
    } catch {
      /* ignore */
    }
    return null
  }
}
