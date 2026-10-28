import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { RuntimeSettings } from "@/lib/settings-store"
import { PUBLIC_SETTINGS_KEYS } from "@/lib/settings-public"

vi.mock("@/lib/require-session", () => ({
  requireSession: vi.fn(),
}))

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
  finishAdminResponse: vi.fn(async (response: Response) => response),
}))

vi.mock("@/lib/settings-store", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock("@/lib/resolve-root-api-key", () => ({
  isLudusRootApiKeyEnvOverrideActive: vi.fn(() => false),
}))

vi.mock("@/lib/goad-ssh", () => ({
  invalidateCatalogCache: vi.fn(),
}))

vi.mock("@/lib/security-audit-log", () => ({
  clientIpFromRequest: vi.fn(() => "203.0.113.5"),
}))

vi.mock("@/lib/app-log", () => ({
  logAppEvent: vi.fn(),
}))

import { GET, POST } from "./route"
import { requireSession } from "@/lib/require-session"
import { requireAdmin } from "@/lib/require-admin"
import { getSettings, updateSettings } from "@/lib/settings-store"

const stored: RuntimeSettings = {
  ludusUrl: "https://ludus.example:8080",
  ludusAdminUrl: "https://ludus.example:8081",
  sshHost: "ludus.example",
  sshPort: 22,
  goadPath: "/opt/GOAD",
  ludushoundPath: "/opt/LudusHound",
  ludusInstallPath: "/opt/ludus",
  goadEnabled: true,
  ludushoundEnabled: false,
  ludusAnsibleVerbose: true,
  useLudusHostDns: false,
  rootApiKey: "ROOT.secret-value",
  blueprintOperatorApiKey: "operator-secret",
  blueprintOperatorUserId: "admin-id",
  proxmoxSshUser: "root",
  proxmoxSshPassword: "ssh-secret",
  proxmoxSshKeyPath: "/app/ssh/id_rsa",
}

function session(isAdmin: boolean) {
  return {
    ok: true as const,
    session: {
      username: isAdmin ? "admin" : "alice",
      isAdmin,
      sshPassword: "login-ssh",
      apiKey: "user-key",
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSettings).mockReturnValue(stored)
  vi.mocked(updateSettings).mockImplementation((patch) => ({ ...stored, ...patch }))
  vi.mocked(requireSession).mockResolvedValue(session(false) as never)
  vi.mocked(requireAdmin).mockResolvedValue(session(true) as never)
})

describe("GET /api/settings", () => {
  it("returns only the allowlist for a non-admin", async () => {
    const res = await GET(new NextRequest("http://localhost/api/settings"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_SETTINGS_KEYS].sort())
    expect(body).not.toHaveProperty("blueprintOperatorApiKey")
    expect(body).not.toHaveProperty("rootApiKey")
    expect(body).not.toHaveProperty("proxmoxSshPassword")
    expect(body.goadEnabled).toBe(true)
  })

  it("returns set flags for an admin and omits secret strings", async () => {
    vi.mocked(requireSession).mockResolvedValue(session(true) as never)
    const res = await GET(new NextRequest("http://localhost/api/settings"))
    const body = await res.json()
    expect(body.rootApiKeySet).toBe(true)
    expect(body.proxmoxSshPasswordSet).toBe(true)
    expect(body.proxmoxSshUser).toBe("root")
    expect(JSON.stringify(body)).not.toContain("ROOT.secret-value")
    expect(JSON.stringify(body)).not.toContain("ssh-secret")
    expect(JSON.stringify(body)).not.toContain("operator-secret")
    expect(body).not.toHaveProperty("blueprintOperatorApiKey")
    expect(body).not.toHaveProperty("rootApiKey")
    expect(body).not.toHaveProperty("proxmoxSshPassword")
  })

  it("returns 401 when the vault session is missing", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    } as never)
    const res = await GET(new NextRequest("http://localhost/api/settings"))
    expect(res.status).toBe(401)
  })
})

describe("POST /api/settings", () => {
  it("does not clear a stored secret when the client sends an empty string", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootApiKey: "", proxmoxSshPassword: "" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(updateSettings).toHaveBeenCalledWith({})
    const body = await res.json()
    expect(body.rootApiKeySet).toBe(true)
    expect(body).not.toHaveProperty("rootApiKey")
  })

  it("rejects an endpoint change without the current SSH password", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sshHost: "evil.example" }),
      }),
    )
    expect(res.status).toBe(403)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it("accepts an endpoint change when the SSH password matches", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sshHost: "evil.example", confirmPassword: "login-ssh" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(updateSettings).toHaveBeenCalledWith({ sshHost: "evil.example" })
  })
})
