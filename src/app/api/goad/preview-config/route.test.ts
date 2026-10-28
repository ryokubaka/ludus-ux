import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/session", () => ({
  resolveSession: vi.fn(),
}))

vi.mock("@/lib/goad-ssh", () => ({
  sshExec: vi.fn(),
  isGoadConfigured: vi.fn(() => true),
}))

vi.mock("@/lib/runtime-paths", () => ({
  resolveGoadPath: vi.fn(() => "/opt/GOAD"),
}))

vi.mock("@/lib/lux-api-audit", () => ({
  logLuxRouteAction: vi.fn(),
}))

vi.mock("@/lib/root-ssh-auth", () => ({
  rootPasswordCredsIfSet: vi.fn(() => {
    throw new Error("preview-config must not select root credentials")
  }),
}))

import { GOAD_PREVIEW_CONFIG_PY } from "@/lib/goad-preview-config-py"
import { POST } from "./route"
import { resolveSession } from "@/lib/session"
import { sshExec } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"

function post(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/goad/preview-config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveSession).mockResolvedValue({
    username: "alice",
    sshPassword: "alice-ssh",
    isAdmin: false,
  } as never)
})

describe("POST /api/goad/preview-config", () => {
  it("embeds a sandboxed renderer that stays under the GOAD root", () => {
    expect(GOAD_PREVIEW_CONFIG_PY).toContain("SandboxedEnvironment")
    expect(GOAD_PREVIEW_CONFIG_PY).toContain("os.path.realpath")
  })

  it("rejects absolute and traversal lab names", async () => {
    for (const lab of ["/tmp/x", "../x", "lab/name"]) {
      const res = await POST(post({ lab, extensions: [] }))
      expect(res.status).toBe(400)
    }
    expect(sshExec).not.toHaveBeenCalled()
    expect(rootPasswordCredsIfSet).not.toHaveBeenCalled()
  })

  it("runs as the session user", async () => {
    vi.mocked(sshExec).mockResolvedValue({ stdout: '{"ok":true,"yaml":"a: 1"}\n', stderr: "", code: 0 })
    const res = await POST(post({ lab: "GOAD", extensions: ["ws01"], provider: "ludus" }))
    expect(res.status).toBe(200)
    expect(sshExec).toHaveBeenCalledWith(expect.any(String), {
      username: "alice",
      password: "alice-ssh",
    })
    expect(rootPasswordCredsIfSet).not.toHaveBeenCalled()
  })

  it("returns 503 when the session has no SSH password", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      username: "alice",
      sshPassword: "",
      isAdmin: false,
    } as never)
    const res = await POST(post({ lab: "GOAD", extensions: [] }))
    expect(res.status).toBe(503)
    expect(sshExec).not.toHaveBeenCalled()
  })
})
