import { describe, expect, it, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import { resetDbForTests } from "./db"
import {
  createAssistantConversation,
  deleteAssistantConversation,
  getAssistantConversation,
  listAssistantConversations,
  updateAssistantConversation,
} from "./assistant-conversation-store"

const TEST_DATA = path.join(process.cwd(), "data-test-assistant-conversations")

describe("assistant-conversation-store", () => {
  const prevData = process.env.DATA_DIR

  beforeEach(() => {
    resetDbForTests()
    fs.mkdirSync(TEST_DATA, { recursive: true })
    process.env.DATA_DIR = TEST_DATA
    const dbFile = path.join(TEST_DATA, "ludus-ux.db")
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile)
    for (const suffix of ["-wal", "-shm"]) {
      const p = `${dbFile}${suffix}`
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  })

  afterEach(() => {
    if (prevData !== undefined) process.env.DATA_DIR = prevData
    else delete process.env.DATA_DIR
  })

  it("creates, lists, updates, and deletes per user", () => {
    const userA = "user-a"
    const userB = "user-b"
    const a = createAssistantConversation(userA, {
      rows: [{ kind: "user", text: "list ranges" }],
    })
    expect(a.title).toMatch(/list ranges/i)
    createAssistantConversation(userB, { rows: [{ kind: "user", text: "other user only" }] })

    expect(listAssistantConversations(userA)).toHaveLength(1)
    expect(listAssistantConversations(userB)).toHaveLength(1)

    const updated = updateAssistantConversation(a.id, userA, {
      rows: [
        { kind: "user", text: "list ranges" },
        { kind: "assistant", text: "here they are" },
      ],
      status: "interrupted",
      pendingConfirm: { token: "t1", summary: "destroy" },
    })
    expect(updated?.status).toBe("interrupted")
    expect(updated?.pendingConfirm?.token).toBe("t1")
    expect(updated?.activeRunId).toBeNull()
    expect(getAssistantConversation(a.id, userB)).toBeNull()

    const withRun = updateAssistantConversation(a.id, userA, {
      status: "running",
      activeRunId: "ar_test",
    })
    expect(withRun?.activeRunId).toBe("ar_test")
    expect(withRun?.status).toBe("running")

    const renamed = updateAssistantConversation(a.id, userA, {
      title: "My lab notes",
      titleLocked: true,
    })
    expect(renamed?.title).toBe("My lab notes")
    expect(renamed?.titleLocked).toBe(true)
    const afterMsg = updateAssistantConversation(a.id, userA, {
      rows: [
        { kind: "user", text: "should not overwrite title" },
        { kind: "assistant", text: "ok" },
      ],
    })
    expect(afterMsg?.title).toBe("My lab notes")

    expect(deleteAssistantConversation(a.id, userA)).toBe(true)
    expect(listAssistantConversations(userA)).toHaveLength(0)
  })
})
