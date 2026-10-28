import { afterEach, describe, expect, it, vi } from "vitest"
import { logInfo } from "./log-safe"

describe("logInfo", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("strips newlines and percent signs and redacts a password-shaped env value", () => {
    vi.stubEnv("LUX_UNIT_PASSWORD", "lux-codeql-secret-value")
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    logInfo("hello\nworld %s secret lux-codeql-secret-value\r")
    expect(spy).toHaveBeenCalledWith("%s", "helloworld %%s secret [redacted]")
  })
})
