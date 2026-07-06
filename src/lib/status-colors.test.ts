import { describe, expect, it } from "vitest"
import { statusText, statusBadge, statusSurface, statusIcon } from "./status-colors"

describe("statusText", () => {
  it("returns correct class for each kind", () => {
    expect(statusText("success")).toBe("text-status-success")
    expect(statusText("warning")).toBe("text-status-warning")
    expect(statusText("error")).toBe("text-status-error")
    expect(statusText("aborted")).toBe("text-status-aborted")
    expect(statusText("neutral")).toBe("text-status-neutral")
    expect(statusText("info")).toBe("text-status-info")
  })
})

describe("statusBadge", () => {
  it("includes bg, text, and border classes", () => {
    const badge = statusBadge("success")
    expect(badge).toContain("bg-status-success/20")
    expect(badge).toContain("text-status-success")
    expect(badge).toContain("border-status-success/30")
  })
})

describe("statusSurface", () => {
  it("includes border, bg, and text classes", () => {
    const surface = statusSurface("error")
    expect(surface).toContain("border-status-error/30")
    expect(surface).toContain("bg-status-error/10")
    expect(surface).toContain("text-status-error")
  })
})

describe("statusIcon", () => {
  it("returns same as statusText", () => {
    expect(statusIcon("warning")).toBe(statusText("warning"))
  })
})
