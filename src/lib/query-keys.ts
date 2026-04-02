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
  rangeEtcHosts:    (rangeId?: string | null) => ["range", "etchosts", rangeId ?? "default"] as const,
  rangeInventory:   (rangeId?: string | null) => ["range", "inventory", rangeId ?? "default"] as const,
  rangeLogs:        (rangeId?: string | null) => ["range", "logs", rangeId ?? "default"] as const,

  // ── Range lists ───────────────────────────────────────────────────────────
  accessibleRanges: () => ["ranges", "accessible"] as const,
  /** GET /range — ranges owned by the effective user (not group-shared-only). */
  rangesOwned:      () => ["ranges", "owned"] as const,
  allRanges:        () => ["ranges", "all"] as const,

  // ── Templates ─────────────────────────────────────────────────────────────
  templates:        () => ["templates"] as const,
  templateStatus:   () => ["templates", "status"] as const,
  templateSources:  (source?: string) => ["templates", "sources", source ?? "default"] as const,

  // ── Users & Auth ──────────────────────────────────────────────────────────
  users:            () => ["users"] as const,
  session:          () => ["session"] as const,

  // ── Ansible ───────────────────────────────────────────────────────────────
  ansible:          () => ["ansible"] as const,

  // ── Blueprints ────────────────────────────────────────────────────────────
  blueprints:            ()           => ["blueprints"] as const,
  blueprintConfig:       (id: string) => ["blueprints", id, "config"] as const,
  blueprintAccessUsers:  (id: string) => ["blueprints", id, "access", "users"] as const,
  blueprintAccessGroups: (id: string) => ["blueprints", id, "access", "groups"] as const,
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

  // ── Settings ──────────────────────────────────────────────────────────────
  settings:         () => ["settings"] as const,
  version:          () => ["version"] as const,

  // ── GOAD ──────────────────────────────────────────────────────────────────
  goadInstances:    () => ["goad", "instances"] as const,
  goadTasks:        () => ["goad", "tasks"] as const,
  goadCatalog:      () => ["goad", "catalog"] as const,
  goadInventories:  (instanceId: string) => ["goad", "instances", instanceId, "inventories"] as const,

  // ── Testing ───────────────────────────────────────────────────────────────
  testingStatus:    (rangeId?: string | null) => ["testing", "status", rangeId ?? "default"] as const,
  allowedDomains:   (rangeId?: string | null) => ["testing", "allowed-domains", rangeId ?? "default"] as const,
  pendingAllows:    (rangeId?: string | null) => ["testing", "pending-allows", rangeId ?? "default"] as const,
  rangeOps:         (rangeId?: string | null) => ["testing", "ops", rangeId ?? "default"] as const,
}
