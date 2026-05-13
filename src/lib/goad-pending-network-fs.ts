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
