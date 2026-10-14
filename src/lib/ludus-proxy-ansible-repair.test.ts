import { describe, expect, it } from "vitest"
import { shouldRepairAnsibleHomeAfterProxyMutation } from "@/lib/ludus-proxy-ansible-repair"

describe("shouldRepairAnsibleHomeAfterProxyMutation", () => {
  it("repairs after POST /ansible/role install", () => {
    expect(
      shouldRepairAnsibleHomeAfterProxyMutation("POST", "/ansible/role", { action: "install" }),
    ).toBe(true)
  })

  it("repairs after POST /ansible/collection install", () => {
    expect(
      shouldRepairAnsibleHomeAfterProxyMutation("POST", "/ansible/collection", {
        action: "install",
        collection: "ansible.windows",
      }),
    ).toBe(true)
  })

  it("repairs after POST /ansible/subscription-roles install", () => {
    expect(
      shouldRepairAnsibleHomeAfterProxyMutation("POST", "/ansible/subscription-roles", {
        action: "install",
      }),
    ).toBe(true)
  })

  it("repairs after POST /blueprints/{id}/install", () => {
    expect(
      shouldRepairAnsibleHomeAfterProxyMutation("POST", "/blueprints/my-lab/install", {}),
    ).toBe(true)
  })

  it("repairs after POST /sources/{id}/sync and install", () => {
    expect(
      shouldRepairAnsibleHomeAfterProxyMutation("POST", "/sources/src-1/sync", {}),
    ).toBe(true)
    expect(
      shouldRepairAnsibleHomeAfterProxyMutation("POST", "/sources/src-1/install", {}),
    ).toBe(true)
  })

  it("ignores non-install ansible actions and GET requests", () => {
    expect(
      shouldRepairAnsibleHomeAfterProxyMutation("POST", "/ansible/role", { action: "remove" }),
    ).toBe(false)
    expect(
      shouldRepairAnsibleHomeAfterProxyMutation("GET", "/ansible", undefined),
    ).toBe(false)
    expect(
      shouldRepairAnsibleHomeAfterProxyMutation("POST", "/range/deploy", {}),
    ).toBe(false)
  })
})
