import { describe, expect, it } from "vitest"
import {
  buildLudusTemplateAddCmd,
  buildLudusTemplateDeleteCmd,
  buildLudusTemplateRmCliCmd,
  derivePackerRootFromPkrPath,
  isLudusCliTemplateAddFailure,
  isLudusTemplateDeleteRefused,
  packerRootCandidates,
  templateDirNameAliases,
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
  it("runs ludus templates add as root with the API key (no sudo -u)", () => {
    const cmd = buildLudusTemplateAddCmd(
      "/opt/ludus/packer/ubuntu-24.04-x64-server",
      "USER.testkey123",
    )
    expect(cmd).toBe(
      "env LUDUS_VERSION=2 LUDUS_API_KEY='USER.testkey123' ludus templates add -d '/opt/ludus/packer/ubuntu-24.04-x64-server'",
    )
    expect(cmd).not.toContain("sudo")
    expect(cmd).not.toContain("runuser")
  })

  it("escapes single quotes in api key", () => {
    const cmd = buildLudusTemplateAddCmd("/opt/ludus/packer/t", "KEY'part")
    expect(cmd).toContain("LUDUS_API_KEY='KEY'\\''part'")
  })
})

describe("isLudusTemplateDeleteRefused", () => {
  it("detects packer included-template soft refuse", () => {
    expect(
      isLudusTemplateDeleteRefused(
        "Built template removed but template 'debian10' is a ludus server included template and cannot be deleted",
      ),
    ).toBe(true)
    expect(isLudusTemplateDeleteRefused("Template 'x' removed")).toBe(false)
  })
})

describe("templateDirNameAliases", () => {
  it("pairs list name with catalog dir without -template", () => {
    expect(templateDirNameAliases("ubuntu-24.04-x64-desktop-template")).toEqual([
      "ubuntu-24.04-x64-desktop-template",
      "ubuntu-24.04-x64-desktop",
    ])
  })

  it("adds -template when given catalog dir", () => {
    expect(templateDirNameAliases("ubuntu-24.04-x64-desktop")).toEqual([
      "ubuntu-24.04-x64-desktop",
      "ubuntu-24.04-x64-desktop-template",
    ])
  })

  it("maps SO list name to source folder securityonion-2.4", () => {
    expect(templateDirNameAliases("securityonion-2.4-x64-template")).toEqual([
      "securityonion-2.4-x64-template",
      "securityonion-2.4-x64",
      "securityonion-2.4",
    ])
  })
})

describe("buildLudusTemplateRmCliCmd", () => {
  it("runs ludus templates rm with API key", () => {
    const cmd = buildLudusTemplateRmCliCmd("securityonion-2.4-x64-template", "USER.key")
    expect(cmd).toContain("ludus templates rm -n 'securityonion-2.4-x64-template'")
    expect(cmd).toContain("LUDUS_API_KEY='USER.key'")
  })
})

describe("buildLudusTemplateDeleteCmd", () => {
  it("removes both list-name and catalog-dir aliases under packer and sources", () => {
    const cmd = buildLudusTemplateDeleteCmd("/opt/ludus", "ubuntu-24.04-x64-desktop-template")
    expect(cmd).toContain("rm -rf")
    expect(cmd).toContain("/packer/")
    expect(cmd).toContain('"$ROOT/users"')
    expect(cmd).toContain("sources")
    expect(cmd).toContain("ubuntu-24.04-x64-desktop-template")
    expect(cmd).toContain("ubuntu-24.04-x64-desktop")
    expect(cmd).toContain("vm_name")
    expect(cmd.startsWith("bash -lc ")).toBe(true)
  })
})
