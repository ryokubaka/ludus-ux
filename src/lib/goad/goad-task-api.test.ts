import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { GoadTask } from "@/lib/goad/goad-task-store"
import { assertGoadTaskAccess, toGoadTaskDetail, toPublicGoadTask } from "@/lib/goad/goad-task-api"
import type { ResolvedSession } from "@/lib/session/session"

vi.mock("@/lib/admin/admin-impersonation-request", () => ({
  effectiveImpersonatedOperatorUsername: async (session: { username: string }) => session.username,
}))

vi.mock("@/lib/session/session-admin-check", () => ({
  liveSessionIsAdmin: async (session: { isAdmin?: boolean }) => session.isAdmin === true,
}))

function baseTask(overrides: Partial<GoadTask> = {}): GoadTask {
  return {
    id: "goad-1",
    command: "install",
    username: "alice",
    lines: ["secret line"],
    lineCount: 1,
    status: "running",
    startedAt: 1,
    ludusApiKey: "ludus-key-secret",
    ...overrides,
  }
}

describe("goad-task-api", () => {
  it("toPublicGoadTask strips secrets and log lines", () => {
    const pub = toPublicGoadTask(baseTask())
    expect(pub).toMatchObject({
      id: "goad-1",
      command: "install",
      status: "running",
      lineCount: 1,
    })
    expect(pub).not.toHaveProperty("ludusApiKey")
    expect(pub).not.toHaveProperty("lines")
  })

  it("toGoadTaskDetail includes lines but not ludusApiKey", () => {
    const detail = toGoadTaskDetail(baseTask())
    expect(detail.lines).toEqual(["secret line"])
    expect(detail).not.toHaveProperty("ludusApiKey")
  })

  it("assertGoadTaskAccess allows owner", async () => {
    const session = { username: "alice", isAdmin: false, apiKey: "k" } as ResolvedSession
    const req = new NextRequest("http://localhost/api/goad/tasks/goad-1")
    expect(await assertGoadTaskAccess(session, req, baseTask())).toBeNull()
  })

  it("assertGoadTaskAccess denies non-owner", async () => {
    const session = { username: "bob", isAdmin: false, apiKey: "k" } as ResolvedSession
    const req = new NextRequest("http://localhost/api/goad/tasks/goad-1")
    const denied = await assertGoadTaskAccess(session, req, baseTask())
    expect(denied?.status).toBe(404)
  })

  it("assertGoadTaskAccess allows admin for any task", async () => {
    const session = { username: "admin", isAdmin: true, apiKey: "k" } as ResolvedSession
    const req = new NextRequest("http://localhost/api/goad/tasks/goad-1")
    expect(await assertGoadTaskAccess(session, req, baseTask({ username: "alice" }))).toBeNull()
  })
})
