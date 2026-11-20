import { describe, expect, it } from "vitest"
import { chosenSelectId, isRangeBuildChoice, rangeBuildWizardSteps, reviewContinueError } from "@/lib/luxai/build-wizard-steps"

describe("rangeBuildWizardSteps", () => {
  it("follows the Ludus scratch wizard, with a networks step before the VMs", () => {
    expect(rangeBuildWizardSteps({ hasKind: true, kind: "ludus", start: "scratch" }).map((step) => step.id)).toEqual([
      "type", "start", "range", "networks", "vms", "domain", "rules", "review",
    ])
  })

  it("follows the blueprint path", () => {
    expect(rangeBuildWizardSteps({ hasKind: true, kind: "ludus", start: "blueprint" }).map((step) => step.label)).toEqual([
      "Config method", "How to start", "Select range", "Choose blueprint", "Review",
    ])
  })

  it("follows the GOAD wizard", () => {
    expect(rangeBuildWizardSteps({ hasKind: true, kind: "GOAD-Mini", start: "scratch" }).map((step) => step.label)).toEqual([
      "Config method", "Select extensions", "Select range", "Network rules", "Review",
    ])
  })

  it("walks a lab that already has a name through range, extensions, and review", () => {
    expect(rangeBuildWizardSteps({ hasKind: false, kind: "", start: "" }).map((step) => step.id)).toEqual([
      "range", "extensions", "review",
    ])
  })
})

describe("review action", () => {
  const action = {
    id: "action",
    kind: "select",
    options: [
      { id: "create", label: "Create the range only" },
      { id: "deploy", label: "Create the range and deploy it" },
    ],
  }

  it("does not pick create-only before the person chooses", () => {
    expect(chosenSelectId(action, {})).toBe("")
    expect(reviewContinueError(true, "")).toBe("Choose create only, or create and deploy.")
    expect(reviewContinueError(true, undefined)).toBe("Choose create only, or create and deploy.")
  })

  it("keeps the choice they made", () => {
    expect(chosenSelectId(action, { action: "deploy" })).toBe("deploy")
    expect(reviewContinueError(true, "deploy")).toBe("")
    expect(reviewContinueError(false, "")).toBe("")
  })

  it("still defaults an ordinary select", () => {
    expect(chosenSelectId({ id: "start", kind: "select", options: [{ id: "scratch" }, { id: "blueprint" }] }, {})).toBe("scratch")
  })
})

describe("isRangeBuildChoice", () => {
  it("treats the build form and the lab placement form as wizards", () => {
    expect(isRangeBuildChoice({ fields: [{ id: "kind" }] })).toBe(true)
    expect(isRangeBuildChoice({ fields: [{ id: "rangeMode" }, { id: "extensions" }] })).toBe(true)
    expect(isRangeBuildChoice({ fields: [{ id: "rangeId" }, { id: "configuration" }] })).toBe(false)
  })
})
