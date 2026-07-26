import { describe, expect, it } from "vitest"
import {
  buildGoadProvisionReplCommand,
  provisionModeLabel,
} from "./goad-provision-target"

describe("buildGoadProvisionReplCommand", () => {
  it("builds entire-lab provision_lab", () => {
    expect(buildGoadProvisionReplCommand("abc123", "entire")).toBe(
      `--repl "use abc123;provision_lab"`,
    )
  })

  it("builds single playbook provision", () => {
    expect(buildGoadProvisionReplCommand("abc123", "single", "ad-acl.yml")).toBe(
      `--repl "use abc123;provision ad-acl.yml"`,
    )
  })

  it("builds from-onward provision_lab_from", () => {
    expect(buildGoadProvisionReplCommand("abc123", "from", "security.yml")).toBe(
      `--repl "use abc123;provision_lab_from security.yml"`,
    )
  })

  it("requires playbook for single/from", () => {
    expect(() => buildGoadProvisionReplCommand("abc123", "single")).toThrow(/Playbook/)
    expect(() => buildGoadProvisionReplCommand("abc123", "from", "  ")).toThrow(/Playbook/)
  })
})

describe("provisionModeLabel", () => {
  it("labels modes", () => {
    expect(provisionModeLabel("entire")).toBe("entire lab")
    expect(provisionModeLabel("single", "x.yml")).toBe("playbook x.yml")
    expect(provisionModeLabel("from", "x.yml")).toBe("from x.yml onward")
  })
})
