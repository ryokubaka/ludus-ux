import { beforeEach, describe, expect, it, vi } from "vitest"

const order: string[] = []

vi.mock("@/lib/goad-ssh", () => ({
  chownGoadInstance: vi.fn(async () => {
    order.push("chown")
  }),
  writeGoadRangeId: vi.fn(async () => {
    order.push("write")
  }),
  listGoadInstances: vi.fn(),
}))

vi.mock("@/lib/goad-instance-range-store", () => ({
  setInstanceRangeLocal: vi.fn(() => {
    order.push("sqlite")
  }),
}))

vi.mock("@/lib/goad-task-store", () => ({
  updateTaskInstance: vi.fn(),
}))

vi.mock("@/lib/goad-deploy-handoff-store", () => ({
  createDeployHandoff: vi.fn(),
  linkHandoffToTask: vi.fn(),
}))

vi.mock("@/lib/root-ssh-auth", () => ({
  rootPasswordCredsIfSet: vi.fn(() => undefined),
}))

vi.mock("@/lib/settings-store", () => ({
  getSettings: vi.fn(() => ({})),
}))

vi.mock("@/lib/range-ownership-store", () => ({
  setOwnership: vi.fn(),
}))

vi.mock("@/lib/ludus-client", () => ({
  ludusRequest: vi.fn(),
}))

vi.mock("@/lib/ludus-user-from-profile", () => ({
  ludusCallerFromGetUser: vi.fn(),
}))

import { chownGoadInstance, writeGoadRangeId } from "@/lib/goad-ssh"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"
import { finalizeGoadDeployLinkage, pickNewGoadInstanceId } from "./goad-deploy-link"

describe("goad-deploy-link", () => {
  it("picks brand-new instance id not in before set", () => {
    const id = pickNewGoadInstanceId(
      [
        { instanceId: "old-a" },
        { instanceId: "new-b" },
      ],
      { rangeId: "alice-GOAD", beforeIds: new Set(["old-a"]) },
    )
    expect(id).toBe("new-b")
  })

  it("prefers instance already tagged with the target rangeId", () => {
    const id = pickNewGoadInstanceId(
      [
        { instanceId: "noise", ludusRangeId: "other" },
        { instanceId: "match", ludusRangeId: "alice-GOAD" },
        { instanceId: "also-new" },
      ],
      { rangeId: "alice-GOAD", beforeIds: new Set(["noise"]) },
    )
    expect(id).toBe("match")
  })

  it("returns null when nothing new", () => {
    const id = pickNewGoadInstanceId([{ instanceId: "only" }], {
      rangeId: "r",
      beforeIds: new Set(["only"]),
    })
    expect(id).toBeNull()
  })
})

const runAsOwner = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }))

describe("finalizeGoadDeployLinkage", () => {
  beforeEach(() => {
    order.length = 0
    vi.clearAllMocks()
  })

  it("chowns the workspace before writing .goad_range_id and then records it", async () => {
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: true })
    expect(order).toEqual(["chown", "write", "sqlite"])
    expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "alice", undefined)
    expect(writeGoadRangeId).toHaveBeenCalledWith("inst-1", "alice-range", runAsOwner)
  })

  it("does not update SQLite when the owner write fails", async () => {
    vi.mocked(writeGoadRangeId).mockRejectedValueOnce(new Error("Permission denied"))
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: false, error: "Permission denied" })
    expect(chownGoadInstance).toHaveBeenCalled()
    expect(writeGoadRangeId).toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("does not write the range file or SQLite when chown fails", async () => {
    vi.mocked(chownGoadInstance).mockRejectedValueOnce(new Error("chown failed"))
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: false, error: "chown failed" })
    expect(chownGoadInstance).toHaveBeenCalled()
    expect(writeGoadRangeId).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })
})
