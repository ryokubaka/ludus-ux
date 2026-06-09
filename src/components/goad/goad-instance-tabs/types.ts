import type { GoadExtensionDef, GoadInstance, GoadLabDef, LogHistoryEntry } from "@/lib/types"
import type { InstanceInventoryFile } from "@/lib/goad-ssh"
import type { CorrelatedHistoryEntry, GoadTaskForCorrelation } from "@/lib/goad-deploy-history-correlation"
import type { RangeLogMarkerEnrichment } from "@/lib/range-log-marker-types"

export type GoadPostProcessingStep = "idle" | "network-pending" | "network-deploying"

export type ConfirmPendingAction = { label: string; fn: () => void; key?: string } | null

export interface GoadDeployTabProps {
  instance: GoadInstance
  instanceId: string
  isRunning: boolean
  isRangeStreaming: boolean
  rangeState: string | null
  currentAction: string | null
  exitCode: number | null
  lines: string[]
  rangeLogLines: string[]
  clear: () => void
  clearRangeLogs: () => void
  handleRefreshRangeLogs: () => void
  rangeLogRefreshBusy: boolean
  rangeElapsed: string | null
  goadElapsed: string | null
  postProcessingStep: GoadPostProcessingStep
}

export interface GoadTerminalTabProps {
  active: boolean
  instanceId: string
  lines: string[]
  isRunning: boolean
  currentAction: string | null
  taskId: string | null
  exitCode: number | null
  clear: () => void
}

export interface GoadInfoTabProps {
  instance: GoadInstance
  instanceId: string
  labInfo: GoadLabDef | undefined
  onViewInventories: () => void
}

export interface GoadInventoriesTabProps {
  active: boolean
  instanceId: string
  inventories: InstanceInventoryFile[]
  inventoriesLoading: boolean
  inventoriesError: string | null
  selectedInventoryName: string | null
  setSelectedInventoryName: (name: string) => void
  fetchInventories: () => void
  copyInventoryToClipboard: (content: string, name: string) => void
  downloadInventory: (content: string, name: string) => void
}

export interface GoadExtensionsTabProps {
  active: boolean
  instance: GoadInstance
  extMap: Record<string, GoadExtensionDef>
  uninstalledExtensions: GoadExtensionDef[]
  builtNames: Set<string>
  allNames: Set<string>
  provisionOnlyExtensionsSupported: boolean
  isRunning: boolean
  pendingAction: ConfirmPendingAction
  commitConfirm: () => void
  cancelConfirm: () => void
  reprovisioningExtension: string | null
  removingExtension: string | null
  onReprovisionExtension: (ext: string) => void
  onRemoveExtension: (ext: string) => void
  onInstallExtension: (extName: string) => void
}

export interface GoadInstanceHeaderProps {
  instance: GoadInstance
  loading: boolean
  refreshing: boolean
  onRefresh: () => void
}

export interface GoadReassignDialogProps {
  open: boolean
  instance: GoadInstance
  reassignUsers: { userID: string }[]
  reassignTargetUser: string
  reassignTargetRange: string
  reassigning: boolean
  onClose: () => void
  onTargetUserChange: (userId: string) => void
  onTargetRangeChange: (rangeId: string) => void
  onSubmit: () => void
}

export interface GoadInstanceActionBarProps {
  instance: GoadInstance
  isAdmin: boolean
  isRunning: boolean
  isAborting: boolean
  initializingRange: boolean
  syncingIps: boolean
  currentAction: string | null
  rangeState: string | null
  pendingAction: ConfirmPendingAction
  commitConfirm: () => void
  cancelConfirm: () => void
  onInstallProvideProvision: () => void
  onProvide: () => void
  onProvisionLab: () => void
  onSyncIps: () => void
  onStart: () => void
  onStop: () => void
  onStatus: () => void
  onAbort: () => void
  onOpenReassign: () => void
  onDeleteInstanceOnly: () => void
  onDestroy: () => void
}

export interface GoadInstanceTabTriggersProps {
  activeTab: string
  isRunning: boolean
  isRangeStreaming: boolean
  extensionCount: number
  inventoryCount: number
  inventoriesLoading: boolean
  onInventoriesOpen: () => void
  onHistoryOpen: () => void
}

export interface GoadHistoryTabProps {
  active: boolean
  instanceId: string
  ludusRangeId: string | undefined
  selectedHistoryEntry: CorrelatedHistoryEntry | null
  historyDetailLoading: boolean
  historyDeployLines: string[]
  historyGoadLines: string[]
  historyLoading: boolean
  deployHistoryLoading: boolean
  deployHistory: LogHistoryEntry[]
  taskHistory: GoadTaskForCorrelation[]
  logMarkerEnrichment: RangeLogMarkerEnrichment | null
  onClearSelection: () => void
  onFetchAllHistory: () => void
  onSelectHistoryEntry: (entry: CorrelatedHistoryEntry) => void | Promise<void>
  onCopyDeployLogId: (id: string) => void
  onCopyTaskId: (id: string) => void
}
