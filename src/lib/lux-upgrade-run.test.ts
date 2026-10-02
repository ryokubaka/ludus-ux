import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const UPDATE_KEY = "ab".repeat(32)

vi.mock("@/lib/settings-store", () => ({
  getSettings: vi.fn(() => ({
    sshHost: "10.0.0.8",
    sshPort: 22,
    proxmoxSshUser: "ludus",
    proxmoxSshPassword: "",
  })),
  getLuxHostUpdateKey: vi.fn(() => UPDATE_KEY),
}))

vi.mock("@/lib/proxmox-ssh", () => ({
  sshExec: vi.fn(),
}))

vi.mock("@/lib/lux-upgrade-docker", () => ({
  dockerSocketAvailable: vi.fn(),
  runHostScriptViaDocker: vi.fn(),
}))

vi.mock("@/lib/lux-releases", () => ({
  listKnownLuxReleaseTags: vi.fn(async () => ["v1.4.0", "v1.4.1"]),
}))

import { sshExec } from "@/lib/proxmox-ssh"
import { dockerSocketAvailable, runHostScriptViaDocker } from "@/lib/lux-upgrade-docker"
import { getLuxHostUpdateKey } from "@/lib/settings-store"
import { luxHostSelfUpdateStdin } from "./lux-host-install"
import { buildHostProbeCmd } from "./lux-upgrade-host"
import { SSH_UPGRADE_NEEDS_LUX_HOST_INSTALL, probeLuxUpgradeHost, startLuxUpgrade } from "./lux-upgrade-run"

const signedUpgrade = luxHostSelfUpdateStdin(
  readFileSync(path.join(process.cwd(), "scripts", "upgrade.sh"), "utf8"),
  UPDATE_KEY,
)

const PROBE = [
  "repo=/opt/ludus-ux",
  "compose=yes",
  "script=yes",
  "git=yes",
  "dirty=no",
  "checkout=v1.4.0",
  "ok=yes",
].join("\n")

describe("lux upgrade host transport", () => {
  const prevRepo = process.env.LUX_REPO_PATH

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLuxHostUpdateKey).mockReturnValue(UPDATE_KEY)
    process.env.LUX_REPO_PATH = "/opt/ludus-ux"
  })

  afterEach(() => {
    if (prevRepo === undefined) delete process.env.LUX_REPO_PATH
    else process.env.LUX_REPO_PATH = prevRepo
  })

  it("probes and starts through lux-host when the Docker socket is absent", async () => {
    vi.mocked(dockerSocketAvailable).mockReturnValue(false)
    vi.mocked(sshExec).mockImplementation(async (...args) => {
      const command = args[4]
      if (Array.isArray(command) && command[0] === "upgrade-probe") return PROBE
      if (Array.isArray(command) && command[0] === "upgrade-start") return "started"
      throw new Error(`unexpected host command ${JSON.stringify(command)}`)
    })

    const probed = await probeLuxUpgradeHost()
    expect(probed.canSwitch).toBe(true)
    expect(probed.repoPath).toBe("/opt/ludus-ux")
    expect(sshExec).toHaveBeenCalledWith(
      "10.0.0.8",
      22,
      "ludus",
      "",
      ["upgrade-probe", "/opt/ludus-ux"],
      { stdin: signedUpgrade },
    )
    expect(runHostScriptViaDocker).not.toHaveBeenCalled()

    const started = await startLuxUpgrade("v1.4.1", false)
    expect(started).toEqual({ ok: true, tag: "v1.4.1" })
    expect(sshExec).toHaveBeenCalledWith(
      "10.0.0.8",
      22,
      "ludus",
      "",
      ["upgrade-start", "/opt/ludus-ux", "v1.4.1"],
      { stdin: signedUpgrade },
    )
  })

  it("does not offer the SSH fallback without the stored update key", async () => {
    vi.mocked(dockerSocketAvailable).mockReturnValue(false)
    vi.mocked(getLuxHostUpdateKey).mockReturnValue("")

    const probed = await probeLuxUpgradeHost()
    expect(probed.canSwitch).toBe(false)
    expect(probed.reason).toBe(SSH_UPGRADE_NEEDS_LUX_HOST_INSTALL)
    expect(sshExec).not.toHaveBeenCalled()
    expect(runHostScriptViaDocker).not.toHaveBeenCalled()
  })

  it("does not offer the SSH fallback when the host rejects the HMAC", async () => {
    vi.mocked(dockerSocketAvailable).mockReturnValue(false)
    vi.mocked(getLuxHostUpdateKey).mockReturnValue(UPDATE_KEY)
    vi.mocked(sshExec).mockRejectedValue(new Error("lux-host: update key"))

    const probed = await probeLuxUpgradeHost()
    expect(probed.canSwitch).toBe(false)
    expect(probed.reason).toBe(SSH_UPGRADE_NEEDS_LUX_HOST_INSTALL)
  })

  it("keeps the host shell on the Docker socket path", async () => {
    vi.mocked(dockerSocketAvailable).mockReturnValue(true)
    vi.mocked(runHostScriptViaDocker).mockResolvedValue(PROBE)

    const probed = await probeLuxUpgradeHost()
    expect(probed.canSwitch).toBe(true)
    expect(runHostScriptViaDocker).toHaveBeenCalledTimes(1)
    expect(runHostScriptViaDocker).toHaveBeenCalledWith(buildHostProbeCmd("/opt/ludus-ux"))
    expect(sshExec).not.toHaveBeenCalled()
  })
})
