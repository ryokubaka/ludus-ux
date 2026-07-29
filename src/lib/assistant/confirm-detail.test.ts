import { describe, expect, it } from "vitest"
import { formatConfirmDetail, formatConfirmSummary } from "./confirm-detail"

describe("formatConfirmDetail", () => {
  it("lists template names from buildTemplates body", () => {
    const detail = formatConfirmDetail({
      operationId: "buildTemplates",
      body: { templates: ["win2019-server-x64-template", "win2016-server-x64-template"] },
    })
    expect(detail).toMatch(/Body:/)
    expect(detail).toMatch(/win2019-server-x64-template/)
    expect(detail).toMatch(/win2016-server-x64-template/)
  })

  it("includes query and path params", () => {
    const detail = formatConfirmDetail({
      operationId: "x",
      pathParams: { id: "abc" },
      query: { force: true },
      body: { ok: 1 },
    })
    expect(detail).toMatch(/Path params:/)
    expect(detail).toMatch(/abc/)
    expect(detail).toMatch(/Query:/)
    expect(detail).toMatch(/Body:/)
  })

  it("formats summary title", () => {
    expect(formatConfirmSummary("post", "/templates", "buildTemplates")).toBe(
      "POST /templates (buildTemplates)",
    )
  })
})
