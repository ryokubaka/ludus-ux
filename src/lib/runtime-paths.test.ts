import { beforeEach, describe, expect, it, vi } from "vitest"
import { goadPathFromEnv, ludusInstallPathFromEnv, ludushoundPathFromEnv } from "./install-path-env"
import type { RuntimeSettings } from "./settings-store"

vi.mock("./settings-store", () => ({
  getSettings: vi.fn(),
}))

import { getSettings } from "./settings-store"
import {
  ludusRangeAnsibleLogPath,
  resolveGoadPath,
  resolveLudusInstallPath,
  resolveLudushoundPath,
} from "./runtime-paths"

function mockSettings(overrides: Partial<RuntimeSettings>): void {
  vi.mocked(getSettings).mockReturnValue({
    ludusUrl: "",
    ludusAdminUrl: "",
    sshHost: "",
    sshPort: 22,
    goadPath: goadPathFromEnv(),
    ludushoundPath: ludushoundPathFromEnv(),
    ludusInstallPath: ludusInstallPathFromEnv(),
    goadEnabled: true,
    ludushoundEnabled: true,
    ludusAnsibleVerbose: true,
    rootApiKey: "",
    blueprintOperatorApiKey: "",
    blueprintOperatorUserId: "",
    proxmoxSshUser: "root",
    proxmoxSshPassword: "",
    proxmoxSshKeyPath: "",
    ...overrides,
  })
}

describe("runtime-paths", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("trims GOAD_PATH from settings", () => {
    const nested = `${goadPathFromEnv()}/nested`
    mockSettings({ goadPath: `  ${nested}  ` })
    expect(resolveGoadPath()).toBe(nested)
  })

  it("trims LUDUSHOUND_PATH from settings", () => {
    const nested = `${ludushoundPathFromEnv()}/nested`
    mockSettings({ ludushoundPath: `  ${nested}  ` })
    expect(resolveLudushoundPath()).toBe(nested)
  })

  it("trims LUDUS_INSTALL_PATH from settings", () => {
    const nested = `${ludusInstallPathFromEnv()}/nested`
    mockSettings({ ludusInstallPath: `  ${nested}  ` })
    expect(resolveLudusInstallPath()).toBe(nested)
  })

  it("builds range ansible log path under Ludus install root", () => {
    const ludusRoot = ludusInstallPathFromEnv()
    mockSettings({ ludusInstallPath: ludusRoot })
    expect(ludusRangeAnsibleLogPath("range-42")).toBe(`${ludusRoot}/ranges/range-42/ansible.log`)
  })

  it("sanitizes unsafe range id segments in ansible log path", () => {
    const ludusRoot = ludusInstallPathFromEnv()
    mockSettings({ ludusInstallPath: ludusRoot })
    expect(ludusRangeAnsibleLogPath("bad/id")).toBe(`${ludusRoot}/ranges/badid/ansible.log`)
  })
})
