/** Client-safe types for LUX range log markers (SQLite lives server-side only). */

export type LuxTestingOpType =
  | "testing_start"
  | "testing_stop"
  | "testing_allow_add"
  | "testing_allow_remove"

export interface LuxRangeTestingEvent {
  id: string
  rangeId: string
  username: string
  opType: LuxTestingOpType
  rangeOpId: string | null
  requestedAt: number
  completedAt: number
  success: boolean
  ludusLogId: string | null
  /** Domain/IP (or full allowedDomains entry) for allowlist add/remove rows. */
  detail: string | null
}

export interface LuxRangeDeployTagRun {
  id: string
  rangeId: string
  username: string
  tagsCsv: string
  requestedAt: number
  ludusLogId: string | null
}

export interface RangeLogMarkerEnrichment {
  testingEvents: LuxRangeTestingEvent[]
  deployTagRuns: LuxRangeDeployTagRun[]
}
