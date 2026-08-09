// ---------------------------------------------------------------------------
// Centralised query key factory
//
// Every key is prefixed with ["@sc", scopeTag, ...] so cache entries never
// bleed across logins or impersonation views (see effective-scope.ts).
// ---------------------------------------------------------------------------

const sc = (scopeTag: string, parts: readonly unknown[]) => ["@sc", scopeTag, ...parts] as const

export const queryKeys = {
  // ── Range ─────────────────────────────────────────────────────────────────
  rangeStatus: (scopeTag: string, rangeId?: string | null) =>
    sc(scopeTag, ["range", "status", rangeId ?? "default"]),
  rangePbStatusDot: (scopeTag: string, rangeId: string) => sc(scopeTag, ["range", "pb-status-dot", rangeId]),
  rangeConfig: (scopeTag: string, rangeId?: string | null) =>
    sc(scopeTag, ["range", "config", rangeId ?? "default"]),

  rangeLogHistory: (scopeTag: string, rangeId?: string | null) =>
    sc(scopeTag, ["range", "logs", "history", rangeId ?? "default"]),

  rangeLogEnrichment: (scopeTag: string, rangeId?: string | null) =>
    sc(scopeTag, ["range", "logs", "enrichment", rangeId ?? "default"]),

  // ── Range lists ───────────────────────────────────────────────────────────
  /** Prefix only — prefer `accessibleRangesList` for full keys. */
  accessibleRanges: () => ["ranges", "accessible"] as const,
  accessibleRangesList: (scopeTag: string) => sc(scopeTag, ["ranges", "accessible"]),
  /** GET /range — ranges owned by the effective user (not group-shared-only). */
  rangesOwned: (scopeTag: string) => sc(scopeTag, ["ranges", "owned"]),
  allRanges: (scopeTag: string) => sc(scopeTag, ["ranges", "all"]),

  // ── Templates ─────────────────────────────────────────────────────────────
  templates: (scopeTag: string) => sc(scopeTag, ["templates"]),
  templateStatus: (scopeTag: string) => sc(scopeTag, ["templates", "status"]),
  templateLogHistory: (scopeTag: string) => sc(scopeTag, ["templates", "logs", "history"]),

  // ── Users & Auth ──────────────────────────────────────────────────────────
  users: (scopeTag: string) => sc(scopeTag, ["users"]),

  // ── Ansible ───────────────────────────────────────────────────────────────
  ansible: (scopeTag: string) => sc(scopeTag, ["ansible"]),

  // ── Sources (Ludus 2.2.0+) ────────────────────────────────────────────────
  sources: (scopeTag: string) => sc(scopeTag, ["sources"]),
  /** Pass `ref` when fetching so cache separates branches; omit when invalidating (prefix match). */
  sourceBlueprints: (scopeTag: string, sourceId: string, ref?: string) =>
    ref
      ? sc(scopeTag, ["sources", sourceId, "blueprints", ref])
      : sc(scopeTag, ["sources", sourceId, "blueprints"]),
  sourceTemplates: (scopeTag: string, sourceId: string, ref?: string) =>
    ref
      ? sc(scopeTag, ["sources", sourceId, "templates", ref])
      : sc(scopeTag, ["sources", sourceId, "templates"]),
  sourceRoles: (scopeTag: string, sourceId: string, ref?: string) =>
    ref
      ? sc(scopeTag, ["sources", sourceId, "roles", "catalog", ref])
      : sc(scopeTag, ["sources", sourceId, "roles", "catalog"]),
  sourceCollections: (scopeTag: string, sourceId: string, ref?: string) =>
    ref
      ? sc(scopeTag, ["sources", sourceId, "collections", "catalog", ref])
      : sc(scopeTag, ["sources", sourceId, "collections", "catalog"]),

  // ── Blueprints ────────────────────────────────────────────────────────────
  blueprints: (scopeTag: string) => sc(scopeTag, ["blueprints"]),
  blueprintDetail: (scopeTag: string, id: string) => sc(scopeTag, ["blueprints", "detail", id]),
  blueprintSharing: (scopeTag: string, id: string) => sc(scopeTag, ["blueprints", id, "sharing"]),

  // ── Groups ────────────────────────────────────────────────────────────────
  /** With `invalidateQueries(..., { exact: false })`, also invalidates all `groupDetail` keys under this scope. */
  groups: (scopeTag: string) => sc(scopeTag, ["groups"]),
  groupDetail: (scopeTag: string, groupName: string) => sc(scopeTag, ["groups", "detail", groupName]),

  // ── Snapshots ─────────────────────────────────────────────────────────────
  snapshots: (scopeTag: string, rangeId?: string | null) =>
    sc(scopeTag, ["snapshots", rangeId ?? "default"]),
  /** Prefix for invalidateQueries — matches every `snapshots(scopeTag, *)` key. */
  snapshotsRoot: (scopeTag: string) => sc(scopeTag, ["snapshots"]),

  // ── Admin ─────────────────────────────────────────────────────────────────
  adminRangesData: (scopeTag: string) => sc(scopeTag, ["admin", "ranges-data"]),
  adminSharedVms: (scopeTag: string) => sc(scopeTag, ["admin", "shared-vms"]),
  adminRangeVms: (scopeTag: string) => sc(scopeTag, ["admin", "range-vms"]),

  // ── Version ───────────────────────────────────────────────────────────────
  version: (scopeTag: string) => sc(scopeTag, ["version"]),

  // ── VM operation audit log (LUX-local SQLite: destroy_vm / remove_extension) ──
  vmOperationLog: (scopeTag: string, rangeId?: string | null) =>
    sc(scopeTag, ["vm-operation-log", rangeId ?? "all"]),

  // ── GOAD ──────────────────────────────────────────────────────────────────
  goadInstances: () => ["goad", "instances"] as const,
  goadInstancesList: (scopeTag: string, bucket: string) => [...queryKeys.goadInstances(), scopeTag, bucket] as const,
  goadInstanceForRange: (scopeTag: string, rangeId: string) => sc(scopeTag, ["goad", "by-range", rangeId]),
  goadTasks: () => ["goad", "tasks"] as const,
  /** Dashboard: poll tasks for one GOAD instance. */
  goadTasksForInstance: (scopeTag: string, instanceId: string) =>
    [...queryKeys.goadTasks(), scopeTag, "for-instance", instanceId] as const,
  /** GOAD home: recent tasks for impersonation bucket. */
  goadTasksForUser: (scopeTag: string, impUser: string) => [...queryKeys.goadTasks(), scopeTag, impUser] as const,

  // ── LudusHound ────────────────────────────────────────────────────────────
  ludushoundStatus: () => ["ludushound", "status"] as const,
  ludushoundStatusScoped: (scopeTag: string) => [...queryKeys.ludushoundStatus(), scopeTag] as const,
  ludushoundWorkspaces: () => ["ludushound", "workspaces"] as const,
  ludushoundWorkspacesList: (scopeTag: string) => [...queryKeys.ludushoundWorkspaces(), scopeTag] as const,
}

/** Keys that change during deploy/build — do not persist to localStorage. */
export function isVolatileQueryKey(queryKey: readonly unknown[]): boolean {
  const parts = queryKey[0] === "@sc" ? queryKey.slice(2) : queryKey
  const head = String(parts[0] ?? "")
  const sub = String(parts[1] ?? "")

  if (head === "range") {
    return sub === "status" || sub === "logs" || sub === "pb-status-dot"
  }
  if (head === "ranges") {
    return sub === "accessible" || sub === "owned" || sub === "all"
  }
  if (head === "templates") {
    return sub === "status" || sub === "logs"
  }
  if (head === "goad" && sub === "tasks") return true
  if (head === "vm-operation-log") return true
  if (head === "admin" && (sub === "range-vms" || sub === "shared-vms")) return true
  if (queryKey[0] === "goad" && queryKey[1] === "tasks") return true
  return false
}
