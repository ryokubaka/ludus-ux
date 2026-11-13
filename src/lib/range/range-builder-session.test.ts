import { describe, expect, it } from "vitest"
import {
  clearRangeBuilderDraft,
  draftAfterSave,
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

  it("keeps edits made after a save of an older snapshot", () => {
    expect(draftAfterSave({ yaml: "vms: [a]", baseline: "vms: []" }, "vms: [a]")).toBeNull()
    expect(draftAfterSave({ yaml: "vms: [a, b]", baseline: "vms: []" }, "vms: [a]")).toEqual({
      yaml: "vms: [a, b]",
      baseline: "vms: [a]",
    })
    expect(draftAfterSave(null, "vms: [a]")).toBeNull()
  })
})
