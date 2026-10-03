import { describe, expect, it } from "vitest"
import { goadLogShowsFailure, goadLogShowsInterrupt } from "./goad-task-outcome"

describe("goad task outcome", () => {
  it("treats a submodule checkout failure as an error", () => {
    const text = "[-] git submodule update failed: Permission denied\n[-] Extension roles are not available; submodule checkout failed"
    expect(goadLogShowsFailure(text)).toBe(true)
  })

  it("does not treat a clean deploy poll as a failure", () => {
    expect(goadLogShowsFailure("[*] deploying...be patient")).toBe(false)
  })

  it("detects the Ctrl+C traceback from a stopped provide", () => {
    expect(goadLogShowsInterrupt("KeyboardInterrupt")).toBe(true)
    expect(goadLogShowsFailure("KeyboardInterrupt")).toBe(false)
  })
})
