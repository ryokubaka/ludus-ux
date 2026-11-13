import { describe, expect, it } from "vitest"
import {
  HOST_RESOURCES_FRESH_MS,
  HOST_RESOURCES_UNAVAILABLE_MS,
  describeHostResourcesView,
} from "@/lib/proxmox/host-resources"

const NOW = 1_000_000_000

describe("describeHostResourcesView", () => {
  it("reports loading when there is no snapshot and a read is in progress", () => {
    const view = describeHostResourcesView({
      hasData: false,
      capturedAt: null,
      now: NOW,
      fetching: true,
      refreshing: false,
      error: null,
    })
    expect(view.state).toBe("loading")
    expect(view.lastVerifiedAt).toBeNull()
  })

  it("reports unavailable when there is no snapshot and the read failed", () => {
    const view = describeHostResourcesView({
      hasData: false,
      capturedAt: null,
      now: NOW,
      fetching: false,
      refreshing: false,
      error: new Error("ssh down"),
    })
    expect(view.state).toBe("unavailable")
    expect(view.lastError).toBe("ssh down")
  })

  it("reports fresh for a recent snapshot", () => {
    const view = describeHostResourcesView({
      hasData: true,
      capturedAt: NOW - 5_000,
      now: NOW,
      fetching: false,
      refreshing: false,
      error: null,
    })
    expect(view.state).toBe("fresh")
    expect(view.lastVerifiedAt).toBe(NOW - 5_000)
    expect(view.ageMs).toBe(5_000)
  })

  it("reports refreshing while a snapshot is revalidated", () => {
    const view = describeHostResourcesView({
      hasData: true,
      capturedAt: NOW - 5_000,
      now: NOW,
      fetching: true,
      refreshing: false,
      error: null,
    })
    expect(view.state).toBe("refreshing")
  })

  it("keeps an old snapshot visible while a refresh is active", () => {
    const view = describeHostResourcesView({
      hasData: true,
      capturedAt: NOW - HOST_RESOURCES_UNAVAILABLE_MS - 10_000,
      now: NOW,
      fetching: false,
      refreshing: true,
      error: new Error("timeout"),
    })
    expect(view.state).toBe("refreshing")
    expect(view.lastError).toBe("timeout")
  })

  it("reports stale for an aging snapshot without an active refresh", () => {
    const view = describeHostResourcesView({
      hasData: true,
      capturedAt: NOW - HOST_RESOURCES_FRESH_MS - 1,
      now: NOW,
      fetching: false,
      refreshing: false,
      error: null,
    })
    expect(view.state).toBe("stale")
  })

  it("reports stale when the last refresh failed but the snapshot is recent", () => {
    const view = describeHostResourcesView({
      hasData: true,
      capturedAt: NOW - 5_000,
      now: NOW,
      fetching: false,
      refreshing: false,
      error: "HTTP 503",
    })
    expect(view.state).toBe("stale")
    expect(view.lastError).toBe("HTTP 503")
  })

  it("reports unavailable when the snapshot is too old and nothing is refreshing", () => {
    const view = describeHostResourcesView({
      hasData: true,
      capturedAt: NOW - HOST_RESOURCES_UNAVAILABLE_MS,
      now: NOW,
      fetching: false,
      refreshing: false,
      error: null,
    })
    expect(view.state).toBe("unavailable")
    expect(view.lastVerifiedAt).toBe(NOW - HOST_RESOURCES_UNAVAILABLE_MS)
  })

  it("ignores non-numeric capture times", () => {
    const view = describeHostResourcesView({
      hasData: true,
      capturedAt: Number.NaN,
      now: NOW,
      fetching: false,
      refreshing: false,
      error: null,
    })
    expect(view.lastVerifiedAt).toBeNull()
    expect(view.state).toBe("fresh")
  })
})
