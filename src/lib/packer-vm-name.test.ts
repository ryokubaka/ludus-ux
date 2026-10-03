import { describe, expect, it } from "vitest"
import {
  ludusTemplateInstallName,
  packerDirFromTemplatePath,
  parsePackerVmName,
  templateBlobRelativePath,
} from "./packer-vm-name"

const DEBIAN13_HCL = `
variable "vm_name" {
 type = string
 default = "debian-13-x64-server-template"
}
source "proxmox-iso" "debian13" {
 vm_name = "\${var.vm_name}"
}
`

describe("parsePackerVmName", () => {
  it("reads the vm_name default and ignores the interpolation", () => {
    expect(parsePackerVmName(DEBIAN13_HCL)).toBe("debian-13-x64-server-template")
  })

  it("reads a literal vm_name assignment", () => {
    expect(parsePackerVmName('vm_name = "ubuntu-24.04-x64-server-template"\n')).toBe(
      "ubuntu-24.04-x64-server-template",
    )
  })

  it("returns null when no literal name is present", () => {
    expect(parsePackerVmName('vm_name = "${var.vm_name}"')).toBeNull()
  })
})

describe("ludusTemplateInstallName", () => {
  it("uses the Packer name for the debian13 directory", () => {
    expect(ludusTemplateInstallName("debian13", DEBIAN13_HCL)).toBe(
      "debian-13-x64-server-template",
    )
  })

  it("keeps the directory when the file has no vm_name", () => {
    expect(ludusTemplateInstallName("debian13", "source {}\n")).toBe("debian13")
  })
})

describe("packerDirFromTemplatePath", () => {
  it("keeps the git folder, not the registered template name", () => {
    expect(
      packerDirFromTemplatePath("templates/debian13", "debian-13-x64-server-template"),
    ).toBe("debian13")
  })

  it("falls back when the path is only the templates root", () => {
    expect(packerDirFromTemplatePath("templates", "debian13")).toBe("debian13")
  })

  it("rejects a segment that is not one safe directory name", () => {
    expect(packerDirFromTemplatePath("templates/foo';id;'", "debian13")).toBeNull()
    expect(packerDirFromTemplatePath("templates/..", "debian13")).toBeNull()
    expect(packerDirFromTemplatePath("templates/.", "debian13")).toBeNull()
    expect(packerDirFromTemplatePath("templates", "..")).toBeNull()
    expect(packerDirFromTemplatePath("templates", ".")).toBeNull()
  })
})

describe("templateBlobRelativePath", () => {
  const prefix = "templates/debian13/"

  it("keeps nested files under the template directory", () => {
    expect(
      templateBlobRelativePath("templates/debian13/http/preseed.cfg", "preseed.cfg", prefix),
    ).toBe("http/preseed.cfg")
  })

  it("rejects a prefix slice that leaves the template directory", () => {
    expect(
      templateBlobRelativePath(
        "templates/debian13/../../etc/cron.d/pwn",
        "pwn",
        prefix,
      ),
    ).toBeNull()
    expect(templateBlobRelativePath("templates/debian13/./secret", "secret", prefix)).toBeNull()
    expect(templateBlobRelativePath("templates/debian13/foo//bar", "bar", prefix)).toBeNull()
    expect(templateBlobRelativePath("templates/debian13/", "debian13", prefix)).toBeNull()
  })

  it("rejects a blob name that leaves the template directory", () => {
    expect(templateBlobRelativePath("elsewhere", "../../etc/cron.d/pwn", prefix)).toBeNull()
    expect(templateBlobRelativePath("elsewhere", "/etc/cron.d/pwn", prefix)).toBeNull()
    expect(templateBlobRelativePath("elsewhere", "..", prefix)).toBeNull()
    expect(templateBlobRelativePath("elsewhere", ".", prefix)).toBeNull()
    expect(templateBlobRelativePath("elsewhere", "", prefix)).toBeNull()
  })
})
