// Ludus API Types — matched to Ludus Server v2.x API responses

// Re-export network rule types so consumers can import from one place
export type { NetworkRule, NetworkConfig, VlanValue, Protocol, RuleAction } from "./network-rules"

export interface LudusVersion {
  result: string
  version?: string
}

export interface LudusError {
  error: string
}

// ── Range / VM ────────────────────────────────────────────────────────────────

export type RangeState =
  | "DEPLOYING"
  | "SUCCESS"
  | "ERROR"
  | "NEVER DEPLOYED"
  | "ABORTED"
  | "WAITING"

/** VM as returned by GET /range */
export interface VMObject {
  ID: number
  proxmoxID: number
  rangeNumber: number
  name: string
  poweredOn: boolean
  ip: string
  // Derived helpers (populated client-side)
  vmName?: string
  powerState?: "running" | "stopped"
}

/** Range as returned by GET /range (v2) */
export interface RangeObject {
  rangeID: string
  name: string
  rangeNumber: number
  rangeState: RangeState
  lastDeployment?: string
  numberOfVMs?: number
  testingEnabled?: boolean
  description?: string
  purpose?: string
  VMs: VMObject[]
  allowedDomains?: string[]
  allowedIPs?: string[]
  // Legacy aliases
  userID?: string
  vms?: VMObject[]
}

/** Entry from GET /ranges/accessible */
export interface RangeAccessEntry {
  rangeNumber: number
  rangeID: string
  accessType: "Direct" | "Group" | string
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface TemplateObject {
  name: string
  built: boolean
  status?: string
  lastBuilt?: string
  /** OS category returned by the Ludus API since v2.0.6 */
  os?: "linux" | "windows" | "macos" | "other"
}

// ── Users ─────────────────────────────────────────────────────────────────────

/** User as returned by GET /user (v2) */
export interface UserObject {
  userID: string
  userNumber?: number
  name?: string
  isAdmin: boolean
  proxmoxUsername?: string
  portforwardingEnabled?: boolean
  dateCreated?: string
  dateLastActive?: string
  // v2 extras
  email?: string
  defaultRangeID?: string
  // Legacy aliases
  rangeID?: string
  lastActivity?: string
}

export interface UserAPIKeyObject {
  result: string  // the API key string
}

// ── Ansible ───────────────────────────────────────────────────────────────────

/** Ansible item as returned by GET /ansible (v2 — lowercase fields) */
export interface AnsibleItem {
  name: string
  version: string
  type: "role" | "collection"
  // v2 does not include a 'global' field
  global?: boolean
  // Legacy uppercase aliases (v1 compat)
  Name?: string
  Version?: string
  Type?: string
  Global?: boolean
}

export interface AnsibleRole {
  name: string
  version?: string
  source?: "galaxy" | "local"
  scope?: "global" | "local"
}

export interface AnsibleCollection {
  name: string
  version?: string
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

/** Single snapshot entry as returned in the flat list from GET /snapshots/list (v2) */
export interface SnapshotInfo {
  name: string
  description?: string
  vmid?: number
  vmname?: string
  snaptime?: number          // unix timestamp
  includesRAM?: boolean
  parent?: string            // parent snapshot name
}

/** Response wrapper from GET /snapshots/list */
export interface SnapshotListResponse {
  snapshots: SnapshotInfo[]
}

export interface SnapshotCreatePayload {
  vmNames?: string[]
  snapshotName: string
  description?: string
  includeRAM?: boolean
}

// ── Blueprints ────────────────────────────────────────────────────────────────

/** v2 blueprint list item — returned by GET /blueprints */
export interface BlueprintListItem {
  id: string
  blueprintID?: string
  name?: string
  description?: string
  ownerID?: string
  access?: "admin" | "owner" | "direct" | "group" | string
  sharedUsers?: number
  sharedGroups?: number
  updatedAt?: string
  created?: string
  updated?: string
}

/** GET /blueprints/{id}/access/users — `access` is how the user inherits rights (often multiple strings). */
export interface BlueprintAccessUserItem {
  userID: string
  name?: string
  access?: string | string[]
  groups?: string[]
}

/** GET /blueprints/{id}/access/groups — not the same shape as users (see api-docs.ludus.cloud). */
export interface BlueprintAccessGroupItem {
  groupName: string
  managers?: string[]
  members?: string[]
}

// ── Groups ────────────────────────────────────────────────────────────────────

/** v2 group object — GET /groups returns summary only (see api-docs.ludus.cloud List all groups). */
export interface GroupObject {
  id?: string
  groupName?: string
  name?: string
  description?: string
  managers?: string[]
  /** Populated only if the server embeds lists; otherwise use GET .../users and .../ranges. */
  members?: string[]
  ranges?: string[]
  numMembers?: number
  numManagers?: number
  numRanges?: number
}

// ── Testing ───────────────────────────────────────────────────────────────────

export interface TestingStatus {
  testingEnabled: boolean
  allowedDomains: string[]
  allowedIPs: string[]
}

// ── Deploy ────────────────────────────────────────────────────────────────────

export interface DeployOptions {
  tags?: string[]
  limit?: string
}

// ── KMS ───────────────────────────────────────────────────────────────────────

export interface KMSStatus {
  enabled: boolean
  vmID?: number
}

// ── Misc ──────────────────────────────────────────────────────────────────────

export interface RangeAccessUser {
  userID: string
  name?: string
  access: string
}

export interface LogLine {
  timestamp?: string
  level?: "INFO" | "WARNING" | "ERROR" | "DEBUG"
  message: string
  raw: string
}

export type PowerAction = "on" | "off"

// ── GOAD ──────────────────────────────────────────────────────────────────────

// String aliases — actual values are discovered dynamically from the server's
// GOAD directory (e.g. /opt/GOAD/ad/ and /opt/GOAD/extensions/).
export type GoadLabType = string
export type GoadExtension = string

export type GoadInstanceStatus = "CREATED" | "PROVIDED" | "READY"

export interface GoadInstance {
  instanceId: string
  lab: GoadLabType
  provider: string
  provisioner: string
  ipRange: string
  status: GoadInstanceStatus
  isDefault: boolean
  extensions: GoadExtension[]
  /** Linux username that owns the instance workspace directory */
  ownerUserId?: string
  /**
   * Dedicated Ludus rangeID for this GOAD instance.
   * Populated from <workspace>/<instanceId>/.goad_range_id (written by our
   * init-range flow) or from the `range_id` field GOAD stores in instance.json.
   * When set, all Ludus operations for this instance target only this range.
   */
  ludusRangeId?: string
}

/** A lab discovered from <goadPath>/ad/<LabName>/data/config.json */
export interface GoadLabDef {
  name: string
  description: string
  vmCount: number
  domains: number
  /** Ludus packer template names required to deploy this lab */
  requiredTemplates: string[]
  /** Whether a providers/ludus/ directory exists for this lab */
  ludusSupported: boolean
}

/** An extension discovered from <goadPath>/extensions/<ext>/config.json */
export interface GoadExtensionDef {
  name: string
  description: string
  machines: string[]
  /** Lab names this extension is compatible with; "*" means all */
  compatibility: string[]
  impact: string
  /** Ludus packer template names required by this extension (beyond the base lab) */
  requiredTemplates: string[]
}

/** Full catalog returned by GET /api/goad/catalog */
export interface GoadCatalog {
  configured: boolean
  goadPath: string
  labs: GoadLabDef[]
  extensions: GoadExtensionDef[]
}

export interface GoadCommand {
  command: string
  args?: string[]
  instanceId?: string
}
