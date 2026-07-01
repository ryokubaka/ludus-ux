import { describe, it, expect } from "vitest"
import { parseLogLine, parseLogLines } from "./log-line-render"

describe("parseLogLine", () => {
  it("flags blank lines", () => {
    const p = parseLogLine("   ", "dark")
    expect(p.isBlank).toBe(true)
    expect(p.isRecap).toBe(false)
  })

  it("extracts a leading wall-clock timestamp", () => {
    const p = parseLogLine("[12:34:56] ok: [host]", "dark")
    expect(p.wallTs).toBe("12:34:56")
    expect(p.body).toBe("ok: [host]")
  })

  it("does not corrupt bracketed bodies without a timestamp", () => {
    const p = parseLogLine("TASK [main : Do X]", "dark")
    expect(p.wallTs).toBeNull()
    expect(p.body).toBe("TASK [main : Do X]")
  })

  it("classifies [ERROR] role lines as error text", () => {
    const p = parseLogLine("[ERROR] something failed", "dark")
    expect(p.isRecap).toBe(false)
    expect(p.bodyCls).toContain("text-status-error")
  })

  it("hides [TASKID] control lines", () => {
    const p = parseLogLine("[TASKID] abc123", "dark")
    expect(p.bodyCls).toBe("hidden")
  })

  it("detects PLAY RECAP stats lines and returns coloured segments", () => {
    const recap = "host1  : ok=5 changed=2 unreachable=0 failed=0 skipped=1 rescued=0 ignored=0"
    const p = parseLogLine(recap, "dark")
    expect(p.isRecap).toBe(true)
    expect(p.segments).not.toBeNull()
    expect(p.segments!.length).toBeGreaterThan(0)
    expect(p.segments!.map((s) => s.text).join("")).toBe(recap)
  })

  it("strips the SSE role prefix from the body", () => {
    const p = parseLogLine("[LUDUS] deploying range", "dark")
    expect(p.body).toBe("deploying range")
  })

  it("recap detection survives a wall-timestamp prefix (body-based)", () => {
    const line = "[12:00:00] host1 : ok=1 changed=0 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0"
    const p = parseLogLine(line, "dark")
    expect(p.wallTs).toBe("12:00:00")
    expect(p.isRecap).toBe(true)
  })
})

describe("parseLogLines", () => {
  it("maps 1:1 with input so indices stay aligned with search results", () => {
    const lines = ["a", "", "TASK [x]", "[ERROR] boom"]
    const parsed = parseLogLines(lines, "dark")
    expect(parsed).toHaveLength(4)
    expect(parsed[1].isBlank).toBe(true)
    expect(parsed[3].bodyCls).toContain("text-status-error")
  })
})
