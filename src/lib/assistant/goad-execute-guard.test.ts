import { describe, expect, it } from "vitest"
import {
  checkExecuteGoadArgs,
  looksLikeGoadOp,
  unknownLudusOpHint,
} from "./goad-execute-guard"

describe("goad-execute-guard", () => {
  it("detects GOAD operation ids", () => {
    expect(looksLikeGoadOp("executeGoad")).toBe(true)
    expect(looksLikeGoadOp("listGoadInstances")).toBe(true)
    expect(looksLikeGoadOp("listTemplates")).toBe(false)
  })

  it("hints call_lux_api when GOAD id used on Ludus surface", () => {
    const hint = unknownLudusOpHint("executeGoad", false)
    expect(hint).toMatch(/call_lux_api/i)
    expect(hint).toMatch(/executeGoad|body\.args/i)
  })

  it("rejects missing args", () => {
    const r = checkExecuteGoadArgs({ labName: "GOAD-Mini" })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/body\.args/i)
      expect(r.assistant_hint).toMatch(/ask_user|goad-deploy/i)
      expect(r.assistant_hint).not.toMatch(/Prefer directing them to \/goad/i)
    }
  })

  it("rejects args array and suggests joined string", () => {
    const r = checkExecuteGoadArgs({
      args: ["-l GOAD-Mini", "-p ludus", "-m local", "-t install"],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/single string|array/i)
      expect(r.assistant_hint).toMatch(/-l GOAD-Mini -p ludus -m local -t install/)
      expect(r.assistant_hint).toMatch(/call_lux_api/i)
    }
  })

  it("accepts a CLI string with rangeId", () => {
    const r = checkExecuteGoadArgs({
      args: "  -l GOAD-Mini -p ludus -m local -t install  ",
      rangeId: "alice-GOAD-Mini-LDQ8",
    })
    expect(r).toEqual({
      ok: true,
      args: "-l GOAD-Mini -p ludus -m local -t install",
    })
  })

  it("rejects wizard JSON dumped into args", () => {
    const r = checkExecuteGoadArgs({
      args: JSON.stringify({
        goadType: "lux_goad",
        extensions: ["smoke-ci"],
        rangeID: "testgoad",
      }),
      rangeId: "testgoad",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/JSON|CLI/i)
      expect(r.assistant_hint).toMatch(/-l GOAD-Mini|--repl/i)
    }
  })

  it("rejects hybrid -l + --repl", () => {
    const r = checkExecuteGoadArgs({
      args:
        `-l 'GOAD-Mini' -p ludus -m local -t install --repl "unload;set_lab GOAD-Mini;set_extensions smoke-ci;create_empty"`,
      rangeId: "catshadowstep",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/mixes|hybrid|--repl/i)
      expect(r.assistant_hint).toMatch(/ONLY|--repl/i)
    }
  })
})
