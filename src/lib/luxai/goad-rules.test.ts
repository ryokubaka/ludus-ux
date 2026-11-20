import { describe, expect, it } from "vitest"
import { applyStoredChange, ChangeStartedError } from "@/lib/luxai/actions"
import { configWithGoadRules, goadRulesSnapshotJson } from "@/lib/luxai/goad-rules"
import type { LuxaiHost } from "@/lib/luxai/tools"
import type { RangeRuleDraft } from "@/lib/luxai/range-vms"

const rule: RangeRuleDraft = {
  name: "allow-lab",
  vlanSrc: "10",
  vlanDst: "wireguard",
  protocol: "tcp",
  ports: "443",
  action: "ACCEPT",
  ipLastOctetSrc: "21",
}

function host(over: Partial<LuxaiHost> = {}): LuxaiHost {
  const unused = async () => {
    throw new Error("not used")
  }
  return {
    listRanges: unused,
    readRange: unused,
    readConfig: async () => "",
    writeConfig: async () => {},
    power: unused,
    deploy: unused,
    readInventory: unused,
    runGuest: unused,
    describeGoad: unused,
    listGoadCatalog: unused,
    createRange: async () => {},
    deleteRange: unused,
    fetchDoc: unused,
    startGoadDeploy: async () => "task-1",
    ...over,
  }
}

describe("GOAD firewall rules on Apply", () => {
  it("keeps an existing range config and records the rule for the post-install merge", () => {
    const yaml = configWithGoadRules("ludus:\n  - vm_name: DC01\n", [rule])
    expect(yaml).toContain("vm_name: DC01")
    expect(yaml).toContain("allow-lab")
    expect(yaml).toContain("21")
    const snapshot = goadRulesSnapshotJson([rule])
    expect(snapshot).toContain("allow-lab")
  })

  it("writes the rules and passes the snapshot to the GOAD install", async () => {
    const writes: string[] = []
    let snapshot: string | undefined
    const detail = await applyStoredChange(
      "goad_deploy",
      "lab",
      "",
      JSON.stringify({
        args: "-l 'GOAD' -p ludus -m local -t install",
        rules: [rule],
        create: { name: "Lab", rangeId: "lab" },
      }),
      host({
        writeConfig: async (_key, _id, yaml) => {
          writes.push(yaml)
        },
        startGoadDeploy: async (_key, _id, _args, networkRulesJson) => {
          snapshot = networkRulesJson
          return "task-9"
        },
      }),
      "key",
    )
    expect(detail).toContain("task-9")
    expect(writes[0]).toContain("allow-lab")
    expect(snapshot).toContain("allow-lab")
  })

  it("leaves a failed config upload pending so Apply can be retried", () => {
    const err = new ChangeStartedError("upload failed", true)
    expect(err.retryable).toBe(true)
    expect(new ChangeStartedError("deploy failed").retryable).toBe(false)
  })
})
