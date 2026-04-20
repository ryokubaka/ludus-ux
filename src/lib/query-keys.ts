// ---------------------------------------------------------------------------
// Centralised query key factory
//
// Using a single source of truth for query keys ensures:
//   1. Cache entries are shared between components that fetch the same data
//      (e.g. range list in sidebar context + admin page)
//   2. `invalidateQueries` calls after mutations are surgical and consistent
//   3. TypeScript can infer key shapes from usage
// ---------------------------------------------------------------------------

export const queryKeys = {
  // ── Range ─────────────────────────────────────────────────────────────────
  rangeStatus:      (rangeId?: string | null) => ["range", "status", rangeId ?? "default"] as const,
  /** PB-backed testing/deploy dots for one range (GET /api/range/pb-status?rangeId=) */
  rangePbStatusDot: (rangeId: string) => ["range", "pb-status-dot", rangeId] as const,
  rangeConfig:      (rangeId?: string | null) => ["range", "config", rangeId ?? "default"] as const,

  rangeLogHistory:  (rangeId?: string | null) => ["range", "logs", "history", rangeId ?? "default"] as const,

  // ── Range lists ───────────────────────────────────────────────────────────
  accessibleRanges: () => ["ranges", "accessible"] as const,
  /** GET /range — ranges owned by the effective user (not group-shared-only). */
  rangesOwned:      () => ["ranges", "owned"] as const,
  allRanges:        () => ["ranges", "all"] as const,

  // ── Templates ─────────────────────────────────────────────────────────────
  templates:        () => ["templates"] as const,
  templateStatus:   () => ["templates", "status"] as const,
  templateLogHistory: () => ["templates", "logs", "history"] as const,

  // ── Users & Auth ──────────────────────────────────────────────────────────
  users:            () => ["users"] as const,

  // ── Ansible ───────────────────────────────────────────────────────────────
  ansible:          () => ["ansible"] as const,

  // ── Blueprints ────────────────────────────────────────────────────────────
  blueprints:            ()           => ["blueprints"] as const,
  /** Combined access lists for blueprint cards / share dialog */
  blueprintSharing: (id: string) => ["blueprints", id, "sharing"] as const,

  // ── Groups ────────────────────────────────────────────────────────────────
  groups:           () => ["groups"] as const,
  /** Members + range IDs for one group (GET /groups/{name}/users + /ranges). */
  groupDetail:      (groupName: string) => ["groups", "detail", groupName] as const,

  // ── Snapshots ─────────────────────────────────────────────────────────────
  snapshots:        () => ["snapshots"] as const,

  // ── Admin ─────────────────────────────────────────────────────────────────
  adminRangesData:  () => ["admin", "ranges-data"] as const,
  adminSharedVms:   () => ["admin", "shared-vms"] as const,

  // ── Version ───────────────────────────────────────────────────────────────
  version:          () => ["version"] as const,

  // ── VM operation audit log (LUX-local SQLite: destroy_vm / remove_extension) ──
  vmOperationLog:   (rangeId?: string | null) => ["vm-operation-log", rangeId ?? "all"] as const,

  // ── GOAD ──────────────────────────────────────────────────────────────────
  goadInstances:    () => ["goad", "instances"] as const,
  /** SQLite map: Ludus rangeID → GOAD instance workspace id */
  goadInstanceForRange: (rangeId: string) => ["goad", "by-range", rangeId] as const,
  goadTasks:        () => ["goad", "tasks"] as const,
}
