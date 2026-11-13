import { describe, expect, it } from "vitest"
import {
  DeployStartupRangeStatusError,
  RangeStatusError,
  TransientRangeStatusError,
  describeRangeRefreshState,
  isTransientRangeStatus,
  rangeErrorHidesStaleData,
  rangeErrorKeepsSnapshot,
} from "@/lib/ui/range-refresh-state"

describe("describeRangeRefreshState", () => {
  it("reports a verified idle state after a successful fetch", () => {
    const meta = describeRangeRefreshState({
      isLoading: false,
      isFetching: false,
      isError: false,
      dataUpdatedAt: 1_700_000_000_000,
      error: null,
    })
    expect(meta.refreshState).toBe("idle")
    expect(meta.lastVerifiedAt).toBe(1_700_000_000_000)
    expect(meta.lastError).toBeNull()
  })

  it("reports an initial refresh while loading", () => {
    const meta = describeRangeRefreshState({
      isLoading: true,
      isFetching: true,
      isError: false,
      dataUpdatedAt: 0,
      error: null,
    })
    expect(meta.refreshState).toBe("refreshing")
    expect(meta.lastVerifiedAt).toBeNull()
  })

  it("keeps the last verified timestamp while retrying a transient failure", () => {
    const meta = describeRangeRefreshState({
      isLoading: false,
      isFetching: true,
      isError: true,
      dataUpdatedAt: 1_700_000_000_000,
      error: new TransientRangeStatusError("HTTP 400"),
    })
    expect(meta.refreshState).toBe("retrying")
    expect(meta.lastVerifiedAt).toBe(1_700_000_000_000)
    expect(meta.lastError).toBe("HTTP 400")
  })

  it("reports unavailable after retries exhaust", () => {
    const meta = describeRangeRefreshState({
      isLoading: false,
      isFetching: false,
      isError: true,
      dataUpdatedAt: 1_700_000_000_000,
      error: new TransientRangeStatusError("HTTP 500"),
    })
    expect(meta.refreshState).toBe("unavailable")
    expect(meta.lastVerifiedAt).toBe(1_700_000_000_000)
  })
})

describe("isTransientRangeStatus", () => {
  it("treats network, 400, and 5xx as transient", () => {
    expect(isTransientRangeStatus(0)).toBe(true)
    expect(isTransientRangeStatus(400)).toBe(true)
    expect(isTransientRangeStatus(500)).toBe(true)
    expect(isTransientRangeStatus(502)).toBe(true)
  })

  it("does not treat auth or other 4xx as transient", () => {
    expect(isTransientRangeStatus(401)).toBe(false)
    expect(isTransientRangeStatus(403)).toBe(false)
    expect(isTransientRangeStatus(404)).toBe(false)
  })
})

describe("rangeErrorHidesStaleData", () => {
  it("hides stale data on auth failures", () => {
    expect(rangeErrorHidesStaleData(new RangeStatusError("forbidden", 403))).toBe(true)
    expect(rangeErrorHidesStaleData(new RangeStatusError("unauthorized", 401))).toBe(true)
  })

  it("keeps stale data for transient failures", () => {
    expect(rangeErrorHidesStaleData(new TransientRangeStatusError("HTTP 400"))).toBe(false)
    expect(rangeErrorHidesStaleData(null)).toBe(false)
  })
})

describe("rangeErrorKeepsSnapshot", () => {
  it("keeps the last VM list after a deploy-startup 400", () => {
    const error = new DeployStartupRangeStatusError("deploy starting")
    expect(error).toBeInstanceOf(TransientRangeStatusError)
    expect(rangeErrorKeepsSnapshot(error)).toBe(true)
  })

  it("does not keep the list for network loss or auth failures", () => {
    expect(rangeErrorKeepsSnapshot(new TransientRangeStatusError("network"))).toBe(false)
    expect(rangeErrorKeepsSnapshot(new RangeStatusError("forbidden", 403))).toBe(false)
  })
})
