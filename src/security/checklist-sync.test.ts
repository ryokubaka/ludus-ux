import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CHECKLIST, applyChecklist, liveStateFromStatuses, resultsFromVitest } from "../../scripts/ci/security-checklist.mjs"

function templateItems(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => /^- \[[ xX]\] /.test(line))
    .map((line) => line.replace(/^- \[[ xX]\] /, ""))
}

describe("security checklist sync", () => {
  it("uses the same sentences as both templates", () => {
    const texts = CHECKLIST.map((item) => item.text)
    expect(templateItems(".github/pull_request_template.md")).toEqual(texts)
    expect(templateItems(".gitlab/merge_request_templates/Default.md")).toEqual(texts)
  })

  it("ticks only the items that passed", () => {
    const body = ["## Security checklist", "", ...CHECKLIST.map((item) => `- [ ] ${item.text}`)].join("\n")
    const states = Object.fromEntries(CHECKLIST.map((item) => [item.id, item.id === "session" ? "pass" : "fail"]))
    const applied = applyChecklist(body, states)
    expect(applied.body).toContain(`- [x] ${CHECKLIST[0].text}`)
    expect(applied.body).toContain(`- [ ] ${CHECKLIST[1].text}`)
    expect(applied.missing).toBe(false)
  })

  it("keeps a checked live box while that suite is still pending", () => {
    const live = CHECKLIST.find((item) => item.id === "live")
    const body = ["## Security checklist", "", `- [x] ${live?.text}`, ""].join("\n")
    const applied = applyChecklist(body, { live: "pending" })
    expect(applied.changed).toBe(false)
    expect(applied.body).toContain(`- [x] ${live?.text}`)
  })

  it("treats the GitLab security-live job as the live suite", () => {
    expect(liveStateFromStatuses([{ id: 2, name: "security-live", status: "success" }])).toBe("pass")
    expect(
      liveStateFromStatuses([
        { id: 1, name: "security-gate/live", status: "success" },
        { id: 3, name: "security-live", status: "failed" },
      ]),
    ).toBe("fail")
    expect(liveStateFromStatuses([{ id: 1, name: "security-live", status: "running" }])).toBe("pending")
  })

  it("leaves other boxes alone when only the live result is known", () => {
    const body = [
      "## Security checklist",
      "",
      `- [x] ${CHECKLIST[0].text}`,
      `- [ ] ${CHECKLIST.find((item) => item.id === "live")?.text}`,
      "",
    ].join("\n")
    const applied = applyChecklist(body, { live: "pass" })
    expect(applied.body).toContain(`- [x] ${CHECKLIST[0].text}`)
    expect(applied.body).toContain("- [x] `bash scripts/ci/live-security.sh` passed")
  })

  it("reads vitest titles into item results", () => {
    const report = {
      testResults: [
        {
          assertionResults: CHECKLIST.flatMap((item) =>
            item.tests.map((title) => ({ title, status: "passed" })),
          ),
        },
      ],
    }
    expect(resultsFromVitest(report).session).toBe("pass")
    expect(resultsFromVitest(report).finding).toBe("pass")
    expect(resultsFromVitest({ testResults: [] }).path).toBe("fail")
  })
})
