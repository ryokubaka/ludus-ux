import { describe, expect, it } from "vitest"
import {
  isBenignBuiltInTemplateNameCollision,
  rewriteSourceInstallWarning,
  rewriteSourceInstallWarnings,
  sanitizeSourceSyncPresentation,
} from "@/lib/source-install-warnings"

const SO_COLLISION =
  'template securityonion-2.4-x64-template: template "securityonion-2.4-x64-template" matches a built-in template name and cannot be installed from a source'

describe("rewriteSourceInstallWarning", () => {
  it("clarifies built-in template name collisions when kept", () => {
    const out = rewriteSourceInstallWarning(SO_COLLISION)
    expect(out).toContain("already exists")
    expect(out).toContain("securityonion-2.4-x64-template")
    expect(out).toContain("Packer vm_name")
    expect(out).not.toMatch(/^template .* matches a built-in template name and cannot be installed/)
  })
})

describe("rewriteSourceInstallWarnings", () => {
  it("drops benign built-in name collisions", () => {
    expect(rewriteSourceInstallWarnings([SO_COLLISION, "role foo: boom"])).toEqual([
      "role foo: boom",
    ])
  })
})

describe("sanitizeSourceSyncPresentation", () => {
  it("hides sync:partial when only false built-in template collisions", () => {
    expect(
      sanitizeSourceSyncPresentation({
        lastSyncStatus: "partial",
        lastSyncError: SO_COLLISION,
      }),
    ).toEqual({ lastSyncStatus: "ok", lastSyncError: undefined })
  })

  it("keeps real sync errors", () => {
    const out = sanitizeSourceSyncPresentation({
      lastSyncStatus: "partial",
      lastSyncError: `${SO_COLLISION}; git fetch failed: auth`,
    })
    expect(out.lastSyncStatus).toBe("partial")
    expect(out.lastSyncError).toContain("git fetch failed")
    expect(out.lastSyncError).not.toMatch(/built-in template name/)
  })

  it("detects benign collisions", () => {
    expect(isBenignBuiltInTemplateNameCollision(SO_COLLISION)).toBe(true)
    expect(isBenignBuiltInTemplateNameCollision("git fetch failed")).toBe(false)
  })
})
