import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RuntimeSettings } from "../settings-store"

vi.mock("../settings-store", () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from "../settings-store"
import { isAssistantConfigured, signConfirmToken, verifyConfirmToken } from "./assistant-config"

function mockSettings(overrides: Partial<RuntimeSettings>): void {
  vi.mocked(getSettings).mockReturnValue({
    ludusUrl: "",
    ludusAdminUrl: "",
    sshHost: "",
    sshPort: 22,
    goadPath: "/opt/GOAD",
    ludusInstallPath: "/opt/ludus",
    goadEnabled: true,
    ludusAnsibleVerbose: true,
    rootApiKey: "",
    blueprintOperatorApiKey: "",
    blueprintOperatorUserId: "",
    proxmoxSshUser: "root",
    proxmoxSshPassword: "",
    proxmoxSshKeyPath: "",
    aiAssistantEnabled: false,
    llmBaseUrl: "",
    llmApiKey: "",
    llmModel: "qwen2.5:14b",
    ...overrides,
  })
}

describe("isAssistantConfigured", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects when disabled", () => {
    mockSettings({ aiAssistantEnabled: false, llmBaseUrl: "http://x/v1", llmModel: "m" })
    expect(isAssistantConfigured().ok).toBe(false)
  })

  it("rejects when URL missing", () => {
    mockSettings({ aiAssistantEnabled: true, llmBaseUrl: "  ", llmModel: "m" })
    expect(isAssistantConfigured().ok).toBe(false)
  })

  it("ok when enabled + url + model", () => {
    mockSettings({ aiAssistantEnabled: true, llmBaseUrl: "http://ollama:11434/v1", llmModel: "qwen2.5:14b" })
    expect(isAssistantConfigured()).toEqual({ ok: true })
  })
})

describe("confirm tokens", () => {
  it("round-trips and rejects tamper", () => {
    const token = signConfirmToken({
      surface: "ludus",
      operationId: "deployRange",
      method: "post",
      path: "/range/deploy",
    })
    const parsed = verifyConfirmToken(token)
    expect(parsed?.operationId).toBe("deployRange")
    expect(verifyConfirmToken(token.slice(0, -2) + "xx")).toBeNull()
  })
})
