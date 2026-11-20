import { describe, expect, it } from "vitest"
import { askHowToBuildRange, offerGoadDeploy } from "@/lib/luxai/goad-offer"
import { matchGoadDeployRequest, resolveGoadDeployPlan } from "@/lib/luxai/goad-plan"
import type { LuxaiChangeView, LuxaiStreamEvent } from "@/lib/luxai/types"

const catalog = {
  labs: [
    { name: "GOAD", description: "Full lab", ludusSupported: true },
    { name: "GOAD-Mini", description: "Small lab", ludusSupported: true },
    { name: "GOAD-Light", description: "Light", ludusSupported: false },
  ],
  extensions: [
    { name: "adcs", description: "Certificate services", compatibility: ["GOAD", "GOAD-Mini"] },
    { name: "elk", description: "Logs", compatibility: ["GOAD"] },
    { name: "ws01", description: "Workstation", compatibility: ["*"] },
  ],
}

describe("GOAD deploy planning", () => {
  it("treats creating a range with GOAD-Mini as a lab request that still needs a range", () => {
    expect(matchGoadDeployRequest("Create me a new range using GOAD-Mini")).toEqual({
      rangeId: "",
      labHint: "GOAD-Mini",
    })
  })

  it("reads a range and GOAD-Mini from a deploy request", () => {
    expect(matchGoadDeployRequest("Using rangeb range, I want to deploy GOAD-Mini")).toEqual({
      rangeId: "rangeb",
      labHint: "GOAD-Mini",
    })
  })

  it("offers only the extensions that lab accepts", () => {
    const intent = matchGoadDeployRequest("Using rangeb range, I want to deploy GOAD-Mini")
    expect(intent).not.toBeNull()
    expect(resolveGoadDeployPlan(intent!, catalog)).toEqual({
      ok: true,
      rangeId: "rangeb",
      lab: "GOAD-Mini",
      description: "Small lab",
      extensions: [
        { name: "adcs", description: "Certificate services" },
        { name: "ws01", description: "Workstation" },
      ],
    })
  })

  it("names the labs that are actually available when the requested one is not", () => {
    const intent = matchGoadDeployRequest("deploy GOAD-Light on range rangeb")
    expect(resolveGoadDeployPlan(intent!, catalog)).toEqual({
      ok: false,
      reason: "missing-lab",
      labHint: "GOAD-Light",
      available: ["GOAD", "GOAD-Mini"],
    })
  })

  it("asks for extensions before a GOAD-Mini deploy is proposed", async () => {
    const intent = matchGoadDeployRequest("Using rangeb range, I want to deploy GOAD-Mini")
    const events: LuxaiStreamEvent[] = []
    let answer: { choiceId: string; selected: string[] } | null = null
    const result = await offerGoadDeploy({
      intent: intent!,
      configured: true,
      catalogError: false,
      catalog,
      rangeExists: true,
      alreadyLinked: false,
      control: () => ({ status: "running", steer: "" }),
      takeAnswer: () => answer,
      propose: (spec) => ({
        id: "c1",
        sessionId: "s",
        rangeId: spec.rangeId,
        kind: "goad_deploy",
        status: "pending",
        summary: spec.summary,
        preview: spec.preview,
        revertable: false,
        createdAt: 1,
      }) satisfies LuxaiChangeView,
      onEvent: (event) => {
        events.push(event)
        if (event.type === "choice") answer = { choiceId: event.choice.id, selected: ["adcs"] }
      },
    })
    const choice = events.find((event) => event.type === "choice")
    expect(choice && choice.type === "choice" ? choice.choice.options.map((option) => option.id) : []).toEqual(["adcs", "ws01"])
    expect(result.stopped).toBe(false)
    expect(result.text).toContain("GOAD-Mini")
    expect(result.text).toContain("rangeb")
    expect(result.text).toContain("adcs")
    expect(result.text).toContain("Apply")
  })

  it("proposes a from-scratch range without another model turn", async () => {
    let answer: { choiceId: string; selected: string[]; values: Record<string, string> } | null = null
    const proposed: Array<{ yaml?: string; deploy?: boolean }> = []
    const result = await askHowToBuildRange({
      intent: { rangeId: "", labHint: "" },
      configured: true,
      catalogError: false,
      catalog,
      templates: [
        { id: "win2022-server-x64-template", os: "windows" },
        { id: "win11-25h2-x64-enterprise-template", os: "windows" },
      ],
      rangeExists: false,
      alreadyLinked: false,
      takeAnswer: () => answer,
      propose: (spec) => {
        proposed.push(spec)
        return {
          id: "c1",
          sessionId: "s",
          rangeId: spec.rangeId,
          kind: "range_create",
          status: "pending",
          summary: spec.summary,
          preview: spec.preview,
          yaml: spec.yaml,
          revertable: false,
          createdAt: 1,
        }
      },
      onEvent: (event) => {
        if (event.type !== "choice") return
        answer = {
          choiceId: event.choice.id,
          selected: [],
          values: {
            kind: "ludus",
            start: "scratch",
            rangeMode: "new",
            rangeId: "lab",
            name: "Lab",
            domain: "meow.local",
            action: "deploy",
            networks: JSON.stringify([{ vlan: "10" }, { vlan: "21" }]),
            vms: JSON.stringify([
              { hostname: "dc01", role: "primary-dc", template: "win2022-server-x64-template", vlan: "10" },
              { hostname: "ws01", role: "workstation", template: "win11-25h2-x64-enterprise-template", vlan: "21" },
            ]),
            rules: "[]",
          },
        }
      },
    })
    expect(result.followUp).toBeUndefined()
    expect(result.stopped).toBe(false)
    expect(result.text).toContain("starts a full deploy")
    expect(proposed).toHaveLength(1)
    expect(proposed[0]?.deploy).toBe(true)
    const yaml = proposed[0]?.yaml ?? ""
    expect(yaml).toContain("sysprep: false")
    expect(yaml).toContain("fqdn: meow.local")
    const workstation = yaml.split("vm_name:").find((part) => part.includes("ws01")) ?? ""
    expect(workstation).not.toContain("domain:")
  })

  it("ignores a question that is not a GOAD deploy", () => {
    expect(matchGoadDeployRequest("What is GOAD-Mini?")).toBeNull()
    expect(matchGoadDeployRequest("Deploy the routers")).toBeNull()
  })
})
