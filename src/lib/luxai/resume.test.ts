import { describe, expect, it } from "vitest"
import { matchGoadDeployRequest, matchOpenRangeRequest } from "@/lib/luxai/goad-plan"
import { appliedProposalId, isResumeQuestion, resumeQuestion } from "@/lib/luxai/resume"

describe("resume after a guest command", () => {
  it("continues the unfinished request and does not start a new range form", () => {
    const question = resumeQuestion("8045c5e6-5d5b-499e-a7c3-06a0826d28da")
    expect(isResumeQuestion(question)).toBe(true)
    expect(question).toContain("read-only")
    expect(question).toContain("8045c5e6-5d5b-499e-a7c3-06a0826d28da")
    expect(matchGoadDeployRequest(question)).toBeNull()
    expect(matchOpenRangeRequest(question)).toBe(false)
  })

  it("finds the proposal id on an apply result that nobody continued", () => {
    expect(appliedProposalId("The operator applied proposal 8045c5e6-5d5b-499e-a7c3-06a0826d28da. PLAY [DC01]")).toBe("8045c5e6-5d5b-499e-a7c3-06a0826d28da")
    expect(appliedProposalId("Proposal 8045c5e6-5d5b-499e-a7c3-06a0826d28da was sent and then failed.")).toBe("8045c5e6-5d5b-499e-a7c3-06a0826d28da")
    expect(appliedProposalId("ESC15 is already set.")).toBe("")
  })
})
