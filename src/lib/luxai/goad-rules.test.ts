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

  it("uploads the GOAD lab config instead of the stock range config", async () => {
    const writes: string[] = []
    const reads: string[] = []
    let snapshot: string | undefined
    let workspace = ""
    const stock = "ludus:\n  - vm_name: \"{{ range_id }}-WIN11-22H2-1\"\n    hostname: \"{{ range_id }}-WIN11-22H2-1\"\n"
    const detail = await applyStoredChange(
      "goad_deploy",
      "lab",
      "",
      JSON.stringify({
        lab: "GOAD-Mini",
        extensions: ["smoke-ci"],
        args: "-l 'GOAD-Mini' -p ludus -m local -t install",
        rules: [rule],
        create: { name: "Lab", rangeId: "lab" },
      }),
      host({
        readConfig: async () => {
          reads.push("read")
          return stock
        },
        renderGoadConfig: async (lab, extensions) => {
          expect(lab).toBe("GOAD-Mini")
          expect(extensions).toEqual(["smoke-ci"])
          return "ludus:\n  - vm_name: \"{{ range_id }}-DC01\"\n    hostname: \"{{ range_id }}-DC01\"\n    template: win2019-server-x64-template\n    windows:\n      sysprep: true\n"
        },
        writeConfig: async (_key, _id, yaml) => {
          writes.push(yaml)
        },
        startGoadDeploy: async (_key, _id, _args, networkRulesJson, workspaceYaml) => {
          snapshot = networkRulesJson
          workspace = workspaceYaml ?? ""
          return "task-9"
        },
      }),
      "key",
    )
    expect(detail).toContain("task-9")
    expect(reads).toEqual([])
    expect(writes[0]).toContain("{{ range_id }}-DC01")
    expect(writes[0]).toMatch(/hostname: DC01\b/)
    expect(writes[0]).not.toMatch(/hostname:.*\{\{ range_id \}\}-DC01/)
    expect(writes[0]).toContain("allow-lab")
    expect(writes[0]).not.toContain("WIN11")
    expect(workspace).toContain("DC01")
    expect(workspace).toContain("allow-lab")
    expect(snapshot).toContain("allow-lab")
  })

  it("leaves the stock config in place when the GOAD checkout cannot be read", async () => {
    const writes: string[] = []
    let started = false
    const attempt = applyStoredChange(
      "goad_deploy",
      "lab",
      "",
      JSON.stringify({
        lab: "GOAD-Mini",
        extensions: [],
        args: "-l 'GOAD-Mini' -p ludus -m local -t install",
        rules: [rule],
        create: { name: "Lab", rangeId: "lab" },
      }),
      host({
        readConfig: async () => "ludus:\n  - hostname: \"{{ range_id }}-WIN11-22H2-1\"\n",
        renderGoadConfig: async () => {
          throw new Error("Lab GOAD-Mini has no ludus provider directory")
        },
        writeConfig: async (_key, _id, yaml) => {
          writes.push(yaml)
        },
        startGoadDeploy: async () => {
          started = true
          return "task"
        },
      }),
      "key",
    )
    await expect(attempt).rejects.toThrow(/provider directory[\s\S]*stock Ludus config was not changed/)
    expect(writes).toEqual([])
    expect(started).toBe(false)
  })

  it("uploads the lab config when a GOAD range is created without deploying", async () => {
    const writes: string[] = []
    await applyStoredChange(
      "range_create",
      "lab",
      "",
      JSON.stringify({
        name: "Lab",
        rangeId: "lab",
        lab: "GOAD-Mini",
        extensions: ["smoke-ci"],
        rules: [rule],
      }),
      host({
        renderGoadConfig: async () => "ludus:\n  - vm_name: \"{{ range_id }}-DC01\"\n    hostname: \"{{ range_id }}-DC01\"\n    template: win2019-server-x64-template\n    windows:\n      sysprep: true\n",
        writeConfig: async (_key, _id, yaml) => {
          writes.push(yaml)
        },
      }),
      "key",
    )
    expect(writes[0]).toContain("{{ range_id }}-DC01")
    expect(writes[0]).toMatch(/hostname: DC01\b/)
    expect(writes[0]).not.toMatch(/hostname:.*\{\{ range_id \}\}-DC01/)
    expect(writes[0]).toContain("allow-lab")
    expect(writes[0]).not.toContain("WIN11")
  })

  it("explains a Windows hostname collision when the range id is already 15 characters", async () => {
    const attempt = applyStoredChange(
      "goad_deploy",
      "luxai-goadmini",
      "",
      JSON.stringify({
        lab: "GOAD-Mini",
        extensions: ["smoke-ci"],
        args: "-l 'GOAD-Mini' -p ludus -m local -t install",
        create: { name: "Lab", rangeId: "luxai-goadmini" },
      }),
      host({
        renderGoadConfig: async () => "ludus:\n  - hostname: \"{{ range_id }}-DC01\"\n",
        writeConfig: async () => {
          throw new Error("Configuration error: duplicate Windows hostname name found: {{ range_id }}-DC01 Windows hostnames are truncated to 15 characters so the first 15 characters must be unique")
        },
      }),
      "key",
    )
    await expect(attempt).rejects.toThrow(/luxai-goadmini" is 14 characters/)
    await expect(attempt).rejects.toThrow(/13 characters or fewer/)
  })

  it("leaves a failed config upload pending so Apply can be retried", () => {
    const err = new ChangeStartedError("upload failed", true)
    expect(err.retryable).toBe(true)
    expect(new ChangeStartedError("deploy failed").retryable).toBe(false)
  })
})
