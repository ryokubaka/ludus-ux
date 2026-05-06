import type { LudusSnapshotMutationResult, SnapshotCreatePayload } from "./types"

/** Query suffix for range-scoped snapshot routes (Ludus `rangeID`). */
export function snapshotsRangeQuery(rangeId?: string): string {
  const id = rangeId?.trim()
  return id ? `?rangeID=${encodeURIComponent(id)}` : ""
}

/** Ludus `POST /snapshots/create` JSON body. */
export function ludusSnapshotCreateBody(payload: SnapshotCreatePayload): Record<string, unknown> {
  const body: Record<string, unknown> = { name: payload.snapshotName }
  if (payload.description !== undefined && payload.description !== "") {
    body.description = payload.description
  }
  if (payload.includeRAM !== undefined) body.includeRAM = payload.includeRAM
  if (payload.vmids && payload.vmids.length > 0) body.vmids = payload.vmids
  return body
}

/** Ludus `POST /snapshots/rollback` and `/snapshots/remove` JSON body. */
export function ludusSnapshotByNameBody(payload: SnapshotCreatePayload): Record<string, unknown> {
  const body: Record<string, unknown> = { name: payload.snapshotName }
  if (payload.vmids && payload.vmids.length > 0) body.vmids = payload.vmids
  return body
}

export type SnapshotMutationOutcome = "ok" | "partial" | "fail"

/** Classify Ludus `{ success, errors }` for UI toasts. */
export function classifySnapshotMutation(
  data: LudusSnapshotMutationResult | null | undefined,
): SnapshotMutationOutcome {
  const nErr = data?.errors?.length ?? 0
  const nOk = data?.success?.length ?? 0
  if (nErr === 0) return "ok"
  if (nOk === 0) return "fail"
  return "partial"
}

export function firstSnapshotMutationErrorMessage(
  data: LudusSnapshotMutationResult | null | undefined,
): string | null {
  const e = data?.errors?.[0]?.error
  return e != null && e !== "" ? e : null
}
