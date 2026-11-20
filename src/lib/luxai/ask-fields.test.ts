import { describe, expect, it } from "vitest"
import { fillAskFields, type AskRangeChoice } from "@/lib/luxai/ask-fields"
import type { LuxaiChoice } from "@/lib/luxai/types"

const ranges: AskRangeChoice[] = [
  { id: "lab", name: "Lab" },
  { id: "smeowden-GOAD-Mini-49UF6C", name: "GOAD Mini" },
]

function choice(fields: LuxaiChoice["fields"], prompt = "Which range and which AD CS configuration?"): LuxaiChoice {
  return { id: "q", prompt, multiple: true, options: [], fields }
}

describe("fillAskFields", () => {
  it("turns an existing range question into that user's ranges", () => {
    const filled = fillAskFields(choice([
      { id: "rangeId", label: "Range id", kind: "text" },
      { id: "notes", label: "What should the range contain?", kind: "text" },
    ]), { ranges, userText: "use the GOAD Mini range" })
    const range = filled.fields?.[0]
    expect(range?.kind).toBe("select")
    expect(range?.options?.[0]?.id).toBe("smeowden-GOAD-Mini-49UF6C")
    expect(range?.options?.map((option) => option.id)).toEqual(["smeowden-GOAD-Mini-49UF6C", "lab"])
    expect(filled.fields?.[1]?.kind).toBe("text")
  })

  it("leaves a new range id as text", () => {
    const filled = fillAskFields(choice([
      { id: "rangeId", label: "New range id", kind: "text" },
    ], "Create a range"), { ranges })
    expect(filled.fields?.[0]?.kind).toBe("text")
  })

  it("lists the AD CS configurations and selects the one named in the message", () => {
    const filled = fillAskFields(choice([
      { id: "rangeId", label: "Range id", kind: "text" },
      { id: "configuration", label: "AD CS configuration", kind: "text" },
    ]), { ranges, userText: "Set ESC6 on lab" })
    const config = filled.fields?.[1]
    expect(config?.kind).toBe("select")
    expect(config?.options?.[0]?.id).toBe("ESC6")
    expect(config?.options?.map((option) => option.id)).toEqual(["ESC6", "ESC15", "ESC1", "ESC2", "ESC3", "ESC9", "ESC16"])
    expect(filled.fields?.[0]?.options?.[0]?.id).toBe("lab")
  })
})
