import { describe, expect, it } from "vitest"
import { blueprintInstallBlock, goadInstallBlock, routerDeployBlock, type HostInventory } from "@/lib/luxai/deploy-readiness"

function inventory(partial: Partial<HostInventory> = {}): HostInventory {
  return {
    built: new Set(["win2019-server-x64-template", "debian-11-x64-server-template"]),
    registered: new Set(["win2019-server-x64-template", "debian-11-x64-server-template", "win11-23h2-x64-enterprise-template"]),
    ansibleRoles: new Set(["geerlingguy.docker"]),
    ansibleCollections: new Set(["ansible.windows"]),
    ansibleKnown: true,
    ludusVersion: "1.0.0",
    ...partial,
  }
}

describe("deploy readiness", () => {
  it("names a template that is registered but not built", () => {
    const reason = goadInstallBlock({
      name: "GOAD",
      ludusSupported: true,
      requiredTemplates: ["win11-23h2-x64-enterprise-template"],
    }, inventory())
    expect(reason).toContain("win11-23h2-x64-enterprise-template (not built)")
  })

  it("names a missing Ansible role", () => {
    const reason = goadInstallBlock({
      name: "elk",
      ludusSupported: true,
      requiredRoles: ["absent.role"],
    }, inventory())
    expect(reason).toBe("Missing Ansible: absent.role")
  })

  it("allows a lab whose templates are built and that needs no extra roles", () => {
    expect(goadInstallBlock({
      name: "GOAD-Mini",
      ludusSupported: true,
      requiredTemplates: ["win2019-server-x64-template"],
    }, inventory())).toBe("")
  })

  it("names a blueprint template that is not built and a role that is not installed", () => {
    const config = [
      "ludus:",
      "  - vm_name: '{{ range_id }}-ws'",
      "    hostname: ws",
      "    template: win11-23h2-x64-enterprise-template",
      "    vlan: 10",
      "    roles:",
      "      - name: absent.role",
    ].join("\n")
    const reason = blueprintInstallBlock(config, null, inventory())
    expect(reason).toContain("win11-23h2-x64-enterprise-template (not built)")
    expect(reason).toContain("Missing Ansible: absent.role")
  })

  it("allows a blueprint whose template and role are installed", () => {
    const config = [
      "ludus:",
      "  - vm_name: '{{ range_id }}-ws'",
      "    hostname: ws",
      "    template: win2019-server-x64-template",
      "    vlan: 10",
      "    roles:",
      "      - name: geerlingguy.docker",
    ].join("\n")
    expect(blueprintInstallBlock(config, "collections:\n  - name: ansible.windows\n", inventory())).toBe("")
  })

  it("blocks a deploy when the router template is not built", () => {
    const reason = routerDeployBlock(inventory({
      built: new Set(["win2019-server-x64-template"]),
    }))
    expect(reason).toContain("not built")
  })
})
