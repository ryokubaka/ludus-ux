import { describe, expect, it } from "vitest"
import {
  buildLudusTemplateAddCmd,
  derivePackerRootFromPkrPath,
  isLudusCliTemplateAddFailure,
  packerRootCandidates,
} from "./template-packer-paths"
import { ludusInstallPathFromEnv } from "./install-path-env"

describe("derivePackerRootFromPkrPath", () => {
  it("derives /opt/ludus/packer from built-in template pkr.hcl", () => {
    expect(
      derivePackerRootFromPkrPath("/opt/ludus/packer/debian12/debian12.pkr.hcl"),
    ).toBe("/opt/ludus/packer")
  })

  it("rejects synced source mirror paths", () => {
    expect(
      derivePackerRootFromPkrPath(
        "/opt/ludus/sources/abc/templates/ubuntu-24.04-x64-server/ubuntu-24.04-x64-server.pkr.hcl",
      ),
    ).toBeNull()
  })
})

describe("packerRootCandidates", () => {
  it("prefers ludusRoot/packer first", () => {
    const root = ludusInstallPathFromEnv()
    expect(packerRootCandidates(root)[0]).toBe(`${root}/packer`)
  })
})

describe("isLudusCliTemplateAddFailure", () => {
  it("treats [ERROR] with exit 0 as failure", () => {
    expect(
      isLudusCliTemplateAddFailure("[ERROR] The ROOT key can only be used for user actions", 0),
    ).toBe(true)
  })

  it("treats already registered as success", () => {
    expect(
      isLudusCliTemplateAddFailure(
        "[ERROR] The uploaded template name is already present on the server",
        0,
      ),
    ).toBe(false)
  })

  it("accepts clean success output", () => {
    expect(isLudusCliTemplateAddFailure('Template "foo" added successfully', 0)).toBe(false)
  })
})

describe("buildLudusTemplateAddCmd", () => {
  it("runs ludus templates add as the target user with API key", () => {
    const cmd = buildLudusTemplateAddCmd(
      "/opt/ludus/packer/ubuntu-24.04-x64-server",
      "admin",
      "USER.testkey123",
    )
    expect(cmd).toContain("sudo -H -u")
    expect(cmd).toContain("_LU='admin'")
    expect(cmd).toContain('LUDUS_API_KEY="$_KEY"')
    expect(cmd).toContain("ludus templates add -d '/opt/ludus/packer/ubuntu-24.04-x64-server'")
  })
})
