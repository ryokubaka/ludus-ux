import { describe, expect, it } from "vitest"
import { pickLatestDeployHistoryEntry } from "./range-deploy-elapsed-anchor"
import type { LogHistoryEntry } from "./types"

function entry(partial: Partial<LogHistoryEntry> & Pick<LogHistoryEntry, "id" | "start" | "status">): LogHistoryEntry {
  return {
    template: "",
    end: partial.end ?? partial.start,
    created: partial.start,
    ...partial,
  }
}

describe("pickLatestDeployHistoryEntry", () => {
  it("picks the newest start when Ludus lists the aborted run first", () => {
    const aborted = entry({
      id: "aborted",
      status: "ABORTED",
      start: "2026-10-21T16:21:53.000Z",
    })
    const success = entry({
      id: "success",
      status: "SUCCESS",
      start: "2026-10-21T17:15:30.000Z",
    })
    expect(pickLatestDeployHistoryEntry([aborted, success])?.id).toBe("success")
  })

  it("prefers an in-flight row over a newer finished one", () => {
    const running = entry({
      id: "running",
      status: "RUNNING",
      start: "2026-10-21T16:00:00.000Z",
    })
    const success = entry({
      id: "success",
      status: "SUCCESS",
      start: "2026-10-21T17:15:30.000Z",
    })
    expect(pickLatestDeployHistoryEntry([success, running])?.id).toBe("running")
  })
})
