/**
 * Dashboard range-refresh state.
 *
 * React Query keeps the last successful `data` when a refetch fails, and
 * `dataUpdatedAt` only advances on success. That gives us a truthful
 * last-verified timestamp. This module turns the query flags into an explicit
 * refresh state so the UI never presents a failed poll as fresh data.
 *
 * Policy: stale rows are shown only while an active retry/reconnect loop is
 * running. Once retries exhaust, the caller renders an unavailable state with
 * the last verified timestamp. Auth/permission failures are not retried and
 * should not keep stale rows on screen.
 */

export type RangeRefreshState = "idle" | "refreshing" | "retrying" | "unavailable"

export interface RangeRefreshMeta {
  /** Timestamp of the last successful verification, or null when never verified. */
  lastVerifiedAt: number | null
  refreshState: RangeRefreshState
  lastError: string | null
}

/** A retryable Ludus range-status failure (HTTP 400 during deploy startup, network, 5xx). */
export class TransientRangeStatusError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TransientRangeStatusError"
  }
}

/**
 * Ludus returns HTTP 400 while a deploy or log stream is starting. That is
 * retryable, and the last verified VM list stays on screen after retries end.
 * Network loss and 5xx still hide that list once retries are exhausted.
 */
export class DeployStartupRangeStatusError extends TransientRangeStatusError {
  constructor(message: string) {
    super(message)
    this.name = "DeployStartupRangeStatusError"
  }
}

/** A non-retryable Ludus range-status failure, including auth/permission errors. */
export class RangeStatusError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "RangeStatusError"
    this.status = status
  }
}

export function isTransientRangeStatus(status: number): boolean {
  return status === 0 || status === 400 || status >= 500
}

export function isAuthRangeStatus(status: number): boolean {
  return status === 401 || status === 403
}

export function describeRangeRefreshState(args: {
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  dataUpdatedAt: number
  error: unknown
}): RangeRefreshMeta {
  const { isLoading, isFetching, isError, dataUpdatedAt, error } = args
  const lastVerifiedAt = dataUpdatedAt > 0 ? dataUpdatedAt : null
  const lastError = error instanceof Error ? error.message : error ? String(error) : null

  if (isError) {
    return {
      lastVerifiedAt,
      refreshState: isFetching ? "retrying" : "unavailable",
      lastError,
    }
  }

  if (isLoading) {
    return { lastVerifiedAt, refreshState: "refreshing", lastError: null }
  }

  return {
    lastVerifiedAt,
    refreshState: isFetching ? "refreshing" : "idle",
    lastError: null,
  }
}

/** True when a non-retryable auth/permission error means stale rows must be hidden. */
export function rangeErrorHidesStaleData(error: unknown): boolean {
  return error instanceof RangeStatusError && isAuthRangeStatus(error.status)
}

/** True when a failed poll should keep the last verified VM snapshot on screen. */
export function rangeErrorKeepsSnapshot(error: unknown): boolean {
  return error instanceof DeployStartupRangeStatusError
}
