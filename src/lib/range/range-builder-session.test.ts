import { describe, expect, it } from "vitest"
import { canonicalRangeYaml } from "./range-builder-document"
import {
  clearRangeBuilderDraft,
  draftAfterSave,
  draftAppliesToSaved,
  readRangeBuilderDraft,
  rememberRangeBuilderDraft,
  rangeBuilderDraftKey,
} from "./range-builder-session"

describe("range builder draft", () => {
  const key = rangeBuilderDraftKey("login|self", "lab")

  it("keeps an unsaved document and drops it once it matches the saved copy", () => {
    clearRangeBuilderDraft(key)
    rememberRangeBuilderDraft(key, "vms: [a]", "vms: []")
    expect(readRangeBuilderDraft(key)).toEqual({ yaml: "vms: [a]", baseline: "vms: []" })
    rememberRangeBuilderDraft(key, "vms: []", "vms: []")
    expect(readRangeBuilderDraft(key)).toBeNull()
  })

  it("drops a draft when the saved file is no longer the one it edited", () => {
    const saved = canonicalRangeYaml("ludus: []\n")
    const edited = canonicalRangeYaml("ludus:\n  - vm_name: a\n")
    const replaced = canonicalRangeYaml("ludus:\n  - vm_name: b\n")
    expect(draftAppliesToSaved({ yaml: edited, baseline: saved }, saved)).toBe(true)
    expect(draftAppliesToSaved({ yaml: edited, baseline: saved }, replaced)).toBe(false)
    expect(draftAppliesToSaved({ yaml: saved, baseline: saved }, saved)).toBe(false)
    expect(draftAppliesToSaved(null, saved)).toBe(false)
  })

  it("keeps edits made after a save of an older snapshot", () => {
    expect(draftAfterSave({ yaml: "vms: [a]", baseline: "vms: []" }, "vms: [a]")).toBeNull()
    expect(draftAfterSave({ yaml: "vms: [a, b]", baseline: "vms: []" }, "vms: [a]")).toEqual({
      yaml: "vms: [a, b]",
      baseline: "vms: [a]",
    })
    expect(draftAfterSave(null, "vms: [a]")).toBeNull()
  })
})
