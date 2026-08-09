import { describe, expect, it } from "vitest"
import { rewriteSourceInstallWarning } from "@/lib/source-install-warnings"

describe("rewriteSourceInstallWarning", () => {
  it("clarifies built-in template name collisions", () => {
    const out = rewriteSourceInstallWarning(
      'template securityonion-2.4-x64-template: template "securityonion-2.4-x64-template" matches a built-in template name and cannot be installed from a source',
    )
    expect(out).toContain("already exists")
    expect(out).toContain("securityonion-2.4-x64-template")
    expect(out).toContain("Packer vm_name")
    expect(out).not.toMatch(/^template .* matches a built-in template name and cannot be installed/)
  })
})
