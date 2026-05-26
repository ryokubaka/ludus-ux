import { describe, expect, it } from "vitest"
import {
  isDeployHistoryRunning,
  pickNetworkFollowupDeployRow,
} from "./wait-lux-network-tag-deploy"
import type { LogHistoryEntry } from "./types"

function entry(partial: Partial<LogHistoryEntry> & Pick<LogHistoryEntry, "start" | "status">): LogHistoryEntry {
  return {
    id: partial.id ?? "log-1",
    start: partial.start,
    end: partial.end ?? partial.start,
    created: partial.created ?? partial.start,
    status: partial.status,
    template: partial.template ?? "",
  }
}

describe("pickNetworkFollowupDeployRow", () => {
  const requestedAtMs = Date.parse("2026-05-26T13:20:00.000Z")

  it("matches explicit network template when complete", () => {
    const row = entry({
      start: "2026-05-26T13:20:36.000Z",
      status: "Success",
      template: "network",
    })
    expect(pickNetworkFollowupDeployRow([row], requestedAtMs)).toBe(row)
  })

  it("matches empty-template row after Success (not only while running)", () => {
    const row = entry({
      start: "2026-05-26T13:20:36.000Z",
      status: "Success",
      template: "",
    })
    expect(pickNetworkFollowupDeployRow([row], requestedAtMs)).toBe(row)
  })

  it("matches empty-template row while running", () => {
    const row = entry({
      start: "2026-05-26T13:20:36.000Z",
      status: "running",
      template: "",
    })
    expect(pickNetworkFollowupDeployRow([row], requestedAtMs)).toBe(row)
  })

  it("ignores empty-template deploys outside the post-trigger window", () => {
    const row = entry({
      start: "2026-05-26T13:30:00.000Z",
      status: "Success",
      template: "",
    })
    expect(pickNetworkFollowupDeployRow([row], requestedAtMs)).toBeNull()
  })
})

describe("isDeployHistoryRunning", () => {
  it("treats Success as terminal", () => {
    expect(isDeployHistoryRunning("Success")).toBe(false)
    expect(isDeployHistoryRunning("running")).toBe(true)
  })
})
