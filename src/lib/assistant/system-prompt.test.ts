import { describe, expect, it } from "vitest"
import { buildAssistantSystemPrompt } from "./system-prompt"

describe("buildAssistantSystemPrompt", () => {
  it("puts user-facing behavior first and forbids invented versions", () => {
    const selectedRangeId = "range-fixture-1"
    const prompt = buildAssistantSystemPrompt({
      skillContext: "# skill\nGOAD goes to LUX",
      selectedRangeId,
    })
    expect(prompt.indexOf("# Role")).toBeLessThan(prompt.indexOf("# skill"))
    expect(prompt).toMatch(/Speak \*\*directly to the user\*\*/i)
    expect(prompt).toMatch(/Never invent/i)
    expect(prompt).toMatch(/getVersion/i)
    expect(prompt).toContain(selectedRangeId)
    expect(prompt).toMatch(/Stay on topic/i)
    expect(prompt).toMatch(/WireGuard/i)
    expect(prompt).toMatch(/search_documentation/i)
    expect(prompt).toMatch(/createElasticServer|range config YAML/i)
    expect(prompt).toMatch(/Uncertainty|clarifying|ask_user|workflows/i)
    expect(prompt).toMatch(/getGoadCatalog|GOAD-Mini|\/goad/i)
    expect(prompt).toMatch(/templateAudit|PHASE 1|lux_goad|ludus_blueprint/i)
    expect(prompt).toMatch(/labs\[0\]|ADFS|never use/i)
    expect(prompt).toMatch(/dedicated|--dedicated|createRange|goad-deploy/i)
    expect(prompt).toMatch(/body\.args|extensions/i)
    expect(prompt).toMatch(/rangeID|extensionNames|network YAML|createRange/i)
    expect(prompt).not.toMatch(/Prefer `\/goad` wizard, or/i)
    expect(prompt).toMatch(/listTemplateSources|addTemplates/i)
    expect(prompt).toMatch(/buildTemplates/i)
    expect(prompt).toMatch(/register|Not Built|Packer/i)
    expect(prompt).toMatch(/\/templates|Long-running/i)
    expect(prompt).toMatch(/skills\/ludus|ludus-skills|supplement/i)
  })

  it("notes when no range is selected", () => {
    const prompt = buildAssistantSystemPrompt({ skillContext: "" })
    expect(prompt).toMatch(/No range is selected/i)
  })
})
