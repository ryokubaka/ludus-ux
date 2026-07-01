import { describe, expect, it } from "vitest"
import { combineTemplateFailure } from "./template-add-errors"

describe("combineTemplateFailure", () => {
  it("returns the SSH message alone when there is no sources error", () => {
    expect(combineTemplateFailure("ssh boom")).toBe("ssh boom")
    expect(combineTemplateFailure("ssh boom", "   ")).toBe("ssh boom")
  })

  it("surfaces a non-404 Sources error alongside the SSH failure", () => {
    const msg = combineTemplateFailure(
      "ludus templates add failed (exit 1)",
      "Ludus Sources error: 500 Internal Server Error",
    )
    expect(msg).toContain("ludus templates add failed")
    expect(msg).toContain("Ludus Sources also failed: Ludus Sources error: 500 Internal Server Error")
  })

  it("falls back to the sources message when SSH message is empty", () => {
    expect(combineTemplateFailure("", "src fail")).toBe("src fail")
  })
})
