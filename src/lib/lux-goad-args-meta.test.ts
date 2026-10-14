import { describe, expect, it } from "vitest"
import {
  parseLuxInstallExtension,
  stripLuxGoadArgsMeta,
  withLuxInstallExtension,
} from "./lux-goad-args-meta"

describe("lux-goad-args-meta", () => {
  it("round-trips marker on provide REPL", () => {
    const base = '--repl "use x;update_instance_files;provide"'
    const full = withLuxInstallExtension(base, "securityonion")
    expect(parseLuxInstallExtension(full)).toBe("securityonion")
    expect(stripLuxGoadArgsMeta(full)).toBe(base)
  })

  it("strip is idempotent when no marker", () => {
    const base = '--repl "use x;provide"'
    expect(stripLuxGoadArgsMeta(base)).toBe(base)
    expect(parseLuxInstallExtension(base)).toBeUndefined()
  })
})
