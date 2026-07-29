import { describe, expect, it } from "vitest"
import { checkCreateRangeBody } from "./create-range-guard"

describe("checkCreateRangeBody", () => {
  it("accepts rangeID + name", () => {
    expect(
      checkCreateRangeBody({
        rangeID: "alice-GOAD-Mini-LDQ8",
        name: "alice-GOAD-Mini-LDQ8",
        description: "Dedicated",
      }),
    ).toEqual({
      ok: true,
      rangeID: "alice-GOAD-Mini-LDQ8",
      name: "alice-GOAD-Mini-LDQ8",
      description: "Dedicated",
    })
  })

  it("rejects missing rangeID", () => {
    const r = checkCreateRangeBody({ name: "goad-mini-range" })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/rangeID and name/i)
      expect(r.assistant_hint).toMatch(/ask_user|rangeID/i)
    }
  })

  it("rejects extensions / networkConfig hallucination", () => {
    const r = checkCreateRangeBody({
      name: "goad-mini-range",
      description: "GOAD-Mini range deployment",
      extensions: ["goad-mini"],
      networkConfig: { type: "custom" },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/extensions|networkConfig/i)
      expect(r.assistant_hint).toMatch(/executeGoad|rangeID/i)
    }
  })
})
