import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { GoadTask } from "@/lib/goad-task-store"
import { assertGoadTaskAccess, toGoadTaskDetail, toPublicGoadTask } from "@/lib/goad-task-api"
import type { ResolvedSession } from "@/lib/session"

vi.mock("@/lib/admin-impersonation-request", () => ({
  effectiveImpersonatedOperatorUsername: (session: { username: string }) => session.username,
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

  it("assertGoadTaskAccess allows owner", () => {
    const session = { username: "alice", isAdmin: false, apiKey: "k" } as ResolvedSession
    const req = new NextRequest("http://localhost/api/goad/tasks/goad-1")
    expect(assertGoadTaskAccess(session, req, baseTask())).toBeNull()
  })

  it("assertGoadTaskAccess denies non-owner", () => {
    const session = { username: "bob", isAdmin: false, apiKey: "k" } as ResolvedSession
    const req = new NextRequest("http://localhost/api/goad/tasks/goad-1")
    const denied = assertGoadTaskAccess(session, req, baseTask())
    expect(denied?.status).toBe(404)
  })

  it("assertGoadTaskAccess allows admin for any task", () => {
    const session = { username: "admin", isAdmin: true, apiKey: "k" } as ResolvedSession
    const req = new NextRequest("http://localhost/api/goad/tasks/goad-1")
    expect(assertGoadTaskAccess(session, req, baseTask({ username: "alice" }))).toBeNull()
  })
})
