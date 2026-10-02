import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  getSettings: vi.fn(() => ({ proxmoxSshUser: "root" })),
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

import { createDeployHandoff } from "@/lib/goad-deploy-handoff-store"
import { chownGoadInstance, listGoadInstances, writeGoadRangeId } from "@/lib/goad-ssh"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"
import { getSettings } from "@/lib/settings-store"
import type { GoadInstance } from "@/lib/types"
import { finalizeGoadDeployLinkage, pickNewGoadInstanceId, scheduleGoadDeployLinkage } from "./goad-deploy-link"

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

function workspace(instanceId: string, ownerUserId: string): GoadInstance {
  return {
    instanceId,
    lab: "GOAD",
    provider: "ludus",
    provisioner: "ansible",
    ipRange: "10.3.10.0/24",
    status: "CREATED",
    isDefault: false,
    extensions: [],
    ownerUserId,
  }
}

const originalGoadSshUser = process.env.GOAD_SSH_USER

function restoreGoadSshUser() {
  if (originalGoadSshUser === undefined) delete process.env.GOAD_SSH_USER
  else process.env.GOAD_SSH_USER = originalGoadSshUser
}

describe("finalizeGoadDeployLinkage", () => {
  beforeEach(() => {
    order.length = 0
    vi.clearAllMocks()
    delete process.env.GOAD_SSH_USER
    vi.mocked(getSettings).mockReturnValue({ proxmoxSshUser: "root" } as ReturnType<typeof getSettings>)
  })

  afterEach(() => {
    restoreGoadSshUser()
  })

  it("chowns a host-owned workspace before writing .goad_range_id and then records it", async () => {
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      directoryOwner: "root",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: true })
    expect(order).toEqual(["chown", "write", "sqlite"])
    expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "alice", undefined)
    expect(writeGoadRangeId).toHaveBeenCalledWith("inst-1", "alice-range", runAsOwner)
  })

  it("chowns a workspace created by the non-root host account", async () => {
    vi.mocked(getSettings).mockReturnValue({ proxmoxSshUser: "ludus" } as ReturnType<typeof getSettings>)
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      directoryOwner: "ludus",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: true })
    expect(order).toEqual(["chown", "write", "sqlite"])
    expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "alice", undefined)
  })

  it("writes the range file when the workspace is already owned by the target user", async () => {
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      directoryOwner: "alice",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: true })
    expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "alice", undefined)
    expect(writeGoadRangeId).toHaveBeenCalledWith("inst-1", "alice-range", runAsOwner)
    expect(setInstanceRangeLocal).toHaveBeenCalledWith("inst-1", "alice-range")
  })

  it("chowns a workspace created by GOAD_SSH_USER when the Settings user is root", async () => {
    process.env.GOAD_SSH_USER = "ludus"
    vi.mocked(getSettings).mockReturnValue({ proxmoxSshUser: "root" } as ReturnType<typeof getSettings>)
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      directoryOwner: "ludus",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: true })
    expect(order).toEqual(["chown", "write", "sqlite"])
    expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "alice", undefined)
    expect(writeGoadRangeId).toHaveBeenCalledWith("inst-1", "alice-range", runAsOwner)
  })

  it("does not chown a Settings-user workspace when GOAD_SSH_USER is a different account", async () => {
    process.env.GOAD_SSH_USER = "ludus"
    vi.mocked(getSettings).mockReturnValue({ proxmoxSshUser: "alice" } as ReturnType<typeof getSettings>)
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "bob-range",
      instanceId: "alice-ws",
      username: "bob",
      directoryOwner: "alice",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: false, error: "Workspace is owned by alice", skip: true })
    expect(chownGoadInstance).not.toHaveBeenCalled()
    expect(writeGoadRangeId).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("does not chown, write, or record a workspace owned by someone else", async () => {
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "bob-range",
      instanceId: "alice-ws",
      username: "bob",
      directoryOwner: "alice",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: false, error: "Workspace is owned by alice", skip: true })
    expect(chownGoadInstance).not.toHaveBeenCalled()
    expect(writeGoadRangeId).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("does not update SQLite when the owner write fails", async () => {
    vi.mocked(writeGoadRangeId).mockRejectedValueOnce(new Error("Permission denied"))
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      directoryOwner: "root",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: false, error: "Permission denied" })
    expect(chownGoadInstance).toHaveBeenCalled()
    expect(writeGoadRangeId).toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("does not chown or record when the directory owner is missing", async () => {
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      directoryOwner: "",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: false, error: "Workspace owner is unresolved", pending: true })
    expect(chownGoadInstance).not.toHaveBeenCalled()
    expect(writeGoadRangeId).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("does not chown or record when the directory owner is only a numeric uid", async () => {
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      directoryOwner: "1000",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: false, error: "Workspace owner is unresolved", pending: true })
    expect(chownGoadInstance).not.toHaveBeenCalled()
    expect(writeGoadRangeId).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })

  it("does not write the range file or SQLite when chown fails", async () => {
    vi.mocked(chownGoadInstance).mockRejectedValueOnce(new Error("chown failed"))
    const linked = await finalizeGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "alice-range",
      instanceId: "inst-1",
      username: "alice",
      directoryOwner: "root",
      runAsOwner,
    })
    expect(linked).toEqual({ ok: false, error: "chown failed" })
    expect(chownGoadInstance).toHaveBeenCalled()
    expect(writeGoadRangeId).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
  })
})

describe("scheduleGoadDeployLinkage", () => {
  beforeEach(() => {
    order.length = 0
    vi.clearAllMocks()
    delete process.env.GOAD_SSH_USER
    vi.mocked(getSettings).mockReturnValue({ proxmoxSshUser: "ludus" } as ReturnType<typeof getSettings>)
    vi.mocked(createDeployHandoff).mockReturnValue({
      id: "handoff-1",
      rangeId: "bob-range",
      username: "bob",
      createdAt: 0,
    })
  })

  afterEach(() => {
    restoreGoadSshUser()
  })

  it("does not chown a known workspace owned by someone else", async () => {
    vi.mocked(listGoadInstances).mockResolvedValue([workspace("alice-ws", "alice")])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    scheduleGoadDeployLinkage({
      taskId: "task-1",
      rangeId: "bob-range",
      username: "bob",
      instanceId: "alice-ws",
      runAsOwner,
    })
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        "[goad-deploy-link] finalize known instance:",
        "Workspace is owned by alice",
      )
    })
    expect(chownGoadInstance).not.toHaveBeenCalled()
    expect(writeGoadRangeId).not.toHaveBeenCalled()
    expect(setInstanceRangeLocal).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("skips another user's new workspace and links a host-owned one", async () => {
    vi.useFakeTimers()
    try {
      let listed = [workspace("alice-ws", "alice")]
      vi.mocked(listGoadInstances).mockImplementation(async () => listed)
      scheduleGoadDeployLinkage({
        taskId: "task-1",
        rangeId: "bob-range",
        username: "bob",
        beforeInstanceIds: [],
        runAsOwner,
      })
      await vi.advanceTimersByTimeAsync(3_000)
      expect(chownGoadInstance).not.toHaveBeenCalled()
      expect(setInstanceRangeLocal).not.toHaveBeenCalled()

      listed = [workspace("alice-ws", "alice"), workspace("bob-ws", "ludus")]
      await vi.advanceTimersByTimeAsync(3_000)
      expect(chownGoadInstance).toHaveBeenCalledWith("bob-ws", "bob", undefined)
      expect(writeGoadRangeId).toHaveBeenCalledWith("bob-ws", "bob-range", runAsOwner)
      expect(setInstanceRangeLocal).toHaveBeenCalledWith("bob-ws", "bob-range")
    } finally {
      vi.useRealTimers()
    }
  })

  it("retries a known instance when the list is empty, then links it once the host owns it", async () => {
    vi.useFakeTimers()
    try {
      let listed: ReturnType<typeof workspace>[] = []
      vi.mocked(listGoadInstances).mockImplementation(async () => listed)
      scheduleGoadDeployLinkage({
        taskId: "task-1",
        rangeId: "alice-range",
        username: "alice",
        instanceId: "inst-1",
        runAsOwner,
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(listGoadInstances).toHaveBeenCalled()
      expect(chownGoadInstance).not.toHaveBeenCalled()
      expect(setInstanceRangeLocal).not.toHaveBeenCalled()

      listed = [workspace("inst-1", "ludus")]
      await vi.advanceTimersByTimeAsync(3_000)
      expect(chownGoadInstance).toHaveBeenCalledWith("inst-1", "alice", undefined)
      expect(writeGoadRangeId).toHaveBeenCalledWith("inst-1", "alice-range", runAsOwner)
      expect(setInstanceRangeLocal).toHaveBeenCalledWith("inst-1", "alice-range")
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps polling a new workspace whose owner is only a uid, then links it", async () => {
    vi.useFakeTimers()
    try {
      let listed = [workspace("new-ws", "1000")]
      vi.mocked(listGoadInstances).mockImplementation(async () => listed)
      scheduleGoadDeployLinkage({
        taskId: "task-1",
        rangeId: "bob-range",
        username: "bob",
        beforeInstanceIds: [],
        runAsOwner,
      })
      await vi.advanceTimersByTimeAsync(3_000)
      expect(chownGoadInstance).not.toHaveBeenCalled()
      expect(setInstanceRangeLocal).not.toHaveBeenCalled()

      listed = [workspace("new-ws", "ludus")]
      await vi.advanceTimersByTimeAsync(3_000)
      expect(chownGoadInstance).toHaveBeenCalledWith("new-ws", "bob", undefined)
      expect(writeGoadRangeId).toHaveBeenCalledWith("new-ws", "bob-range", runAsOwner)
      expect(setInstanceRangeLocal).toHaveBeenCalledWith("new-ws", "bob-range")
    } finally {
      vi.useRealTimers()
    }
  })
})
