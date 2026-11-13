/**
 * Dashboard host-resource view model.
 *
 * The API returns a snapshot captured by `pvesh` over host SSH, plus whether a
 * background refresh is running and the last refresh error. The dashboard must
 * never present a cached snapshot as current: this module classifies it so the
 * card can show "Updated", "Refreshing", or "Unavailable — last verified …".
 */

import type { NodeResourceSample } from "@/lib/proxmox/proxmox-node-metrics-parse"

export interface HostResourceNode extends NodeResourceSample {
  name: string
}

export interface HostResourcesSnapshot {
  /** When `pvesh` produced this sample, in epoch milliseconds. */
  capturedAt: number
  nodes: HostResourceNode[]
}

export interface HostResourcesPayload extends HostResourcesSnapshot {
  /** True while the server is revalidating the snapshot over SSH. */
  refreshing: boolean
  /** Last background refresh error, when the most recent refresh failed. */
  error?: string
}

/** A snapshot younger than this is shown as current without a warning. */
export const HOST_RESOURCES_FRESH_MS = 30_000

/** After this age, a snapshot is shown as unavailable even if no refresh is running. */
export const HOST_RESOURCES_UNAVAILABLE_MS = 90_000

export type HostResourcesViewState =
  | "loading"
  | "refreshing"
  | "fresh"
  | "stale"
  | "unavailable"

export interface HostResourcesViewMeta {
  state: HostResourcesViewState
  lastVerifiedAt: number | null
  ageMs: number | null
  lastError: string | null
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message || null
  if (typeof error === "string" && error.trim()) return error
  return null
}

/**
 * Classify a snapshot for display.
 *
 * Policy: a verified snapshot stays on screen only while a refresh is active or
 * while it is recent. Once it is older than the unavailable threshold and no
 * refresh is running, the card reports it as unavailable with its last-verified
 * timestamp instead of implying it is current.
 */
export function describeHostResourcesView(args: {
  hasData: boolean
  capturedAt: number | null
  now: number
  fetching: boolean
  refreshing: boolean
  error: unknown
}): HostResourcesViewMeta {
  const lastVerifiedAt =
    typeof args.capturedAt === "number" && Number.isFinite(args.capturedAt) && args.capturedAt > 0
      ? args.capturedAt
      : null
  const ageMs = lastVerifiedAt != null ? Math.max(0, args.now - lastVerifiedAt) : null
  const lastError = errorMessage(args.error)
  const active = args.fetching || args.refreshing

  if (!args.hasData) {
    if (active) return { state: "loading", lastVerifiedAt, ageMs, lastError }
    if (lastError) return { state: "unavailable", lastVerifiedAt, ageMs, lastError }
    return { state: "loading", lastVerifiedAt, ageMs, lastError: null }
  }

  if (active) {
    return { state: "refreshing", lastVerifiedAt, ageMs, lastError }
  }

  if (ageMs != null && ageMs >= HOST_RESOURCES_UNAVAILABLE_MS) {
    return { state: "unavailable", lastVerifiedAt, ageMs, lastError }
  }

  if (lastError) {
    return { state: "stale", lastVerifiedAt, ageMs, lastError }
  }

  if (ageMs != null && ageMs >= HOST_RESOURCES_FRESH_MS) {
    return { state: "stale", lastVerifiedAt, ageMs, lastError: null }
  }

  return { state: "fresh", lastVerifiedAt, ageMs, lastError: null }
}
