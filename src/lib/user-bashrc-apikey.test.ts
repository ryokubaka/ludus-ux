import { describe, expect, it } from "vitest"
import { isValidLudusSshUsername, parseLudusApiKeyFromBashrcLine } from "./user-bashrc-apikey"

describe("user-bashrc-apikey", () => {
  it("parses quoted and unquoted LUDUS_API_KEY lines", () => {
    expect(parseLudusApiKeyFromBashrcLine('export LUDUS_API_KEY=USER.abc123')).toBe("USER.abc123")
    expect(parseLudusApiKeyFromBashrcLine("export LUDUS_API_KEY='USER.def456'")).toBe("USER.def456")
    expect(parseLudusApiKeyFromBashrcLine('LUDUS_API_KEY="USER.ghi789"')).toBe("USER.ghi789")
  })

  it("validates posix ssh usernames", () => {
    expect(isValidLudusSshUsername("adminuser")).toBe(true)
    expect(isValidLudusSshUsername("pw-test-two")).toBe(true)
    expect(isValidLudusSshUsername("bad user")).toBe(false)
  })

  it("parses keys with percent signs from bashrc export lines", () => {
    const line = "export LUDUS_API_KEY=testuser.SAMPLE_ilTUNr%1H_%ProP%E0ROD78c%-t8sY2"
    expect(parseLudusApiKeyFromBashrcLine(line)).toBe(
      "testuser.SAMPLE_ilTUNr%1H_%ProP%E0ROD78c%-t8sY2",
    )
  })
})
