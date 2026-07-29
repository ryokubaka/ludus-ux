import { describe, expect, it } from "vitest"
import { kickoffMonitorGuidance } from "./kickoff-monitor"

describe("kickoffMonitorGuidance", () => {
  it("guides Packer build to /templates without re-POST", () => {
    const g = kickoffMonitorGuidance({
      surface: "ludus",
      method: "post",
      path: "/templates",
      operationId: "buildTemplates",
    })
    expect(g?.pagePath).toBe("/templates")
    expect(g?.assistantInstructions).toMatch(/NEVER call buildTemplates/i)
    expect(g?.userBlurb).toMatch(/Templates/i)
  })

  it("returns null for unrelated ops", () => {
    expect(
      kickoffMonitorGuidance({
        surface: "ludus",
        method: "get",
        path: "/templates",
        operationId: "listTemplates",
      }),
    ).toBeNull()
  })
})
