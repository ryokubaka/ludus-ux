import { describe, expect, it } from "vitest"
import {
  classifyTemplateDeleteFailure,
  extractTemplateVmidFromBlockerText,
  httpStatusForTemplateDeleteError,
  isTemplateBlockedByLinkedClones,
} from "./template-delete-errors"

describe("isTemplateBlockedByLinkedClones", () => {
  it("detects Proxmox linked-clone blocker text", () => {
    expect(
      isTemplateBlockedByLinkedClones(
        "[ERROR] base volume 'ludus:110/base-110-disk-0.qcow2' is still in use by linked cloned",
      ),
    ).toBe(true)
  })

  it("ignores unrelated errors", () => {
    expect(isTemplateBlockedByLinkedClones("Template removed")).toBe(false)
  })
})

describe("extractTemplateVmidFromBlockerText", () => {
  it("parses VMID from ludus volume path", () => {
    expect(
      extractTemplateVmidFromBlockerText("base volume 'ludus:110/base-110-disk-0.qcow2'"),
    ).toBe(110)
  })
})

describe("classifyTemplateDeleteFailure", () => {
  it("returns in-use payload with action URL for linked clones", () => {
    const payload = classifyTemplateDeleteFailure({
      templateName: "securityonion-2.4-x64-template",
      sshOut:
        "[ERROR] base volume 'ludus:110/base-110-disk-0.qcow2' is still in use by linked cloned",
      stillListed: true,
    })
    expect(payload.code).toBe("TEMPLATE_IN_USE_BY_VMS")
    expect(payload.actionUrl).toBe(
      "/admin?tab=vms&template=securityonion-2.4-x64-template",
    )
    expect(payload.error).toContain("securityonion-2.4-x64-template")
    expect(payload.error).not.toContain("[ERROR]")
  })

  it("returns included-template message without VM tab link", () => {
    const payload = classifyTemplateDeleteFailure({
      templateName: "debian10",
      apiRefused: true,
      apiMessage: "included template and cannot be deleted",
    })
    expect(payload.code).toBe("TEMPLATE_INCLUDED")
    expect(payload.actionUrl).toBeUndefined()
  })

  it("prefers linked-clone over included when both signals present", () => {
    const payload = classifyTemplateDeleteFailure({
      templateName: "foo-template",
      apiRefused: true,
      apiMessage: "included template",
      sshOut: "still in use by linked clone",
      stillListed: true,
    })
    expect(payload.code).toBe("TEMPLATE_IN_USE_BY_VMS")
    expect(payload.actionUrl).toBeDefined()
  })
})

describe("httpStatusForTemplateDeleteError", () => {
  it("uses 409 for in-use", () => {
    expect(httpStatusForTemplateDeleteError("TEMPLATE_IN_USE_BY_VMS")).toBe(409)
  })

  it("uses 502 for other failures", () => {
    expect(httpStatusForTemplateDeleteError("TEMPLATE_DELETE_FAILED")).toBe(502)
  })
})
