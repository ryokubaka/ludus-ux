import { describe, expect, it } from "vitest"
import { loadLudusUxSkillContext, ludusUxSkillRootExists } from "./skill-loader"

describe("skill-loader", () => {
  it("finds skills/ludus-ux", () => {
    expect(ludusUxSkillRootExists()).toBe(true)
  })

  it("loads SKILL.md into context without troubleshooting dump", () => {
    const ctx = loadLudusUxSkillContext()
    expect(ctx).toMatch(/ludus/i)
    expect(ctx.length).toBeGreaterThan(200)
    expect(ctx.toLowerCase()).not.toMatch(/debugging wireguard/)
  })
})
