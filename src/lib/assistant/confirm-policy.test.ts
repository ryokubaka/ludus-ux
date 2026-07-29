import { describe, expect, it } from "vitest"
import {
  applyConfirmMode,
  confirmOpKey,
  emptyConfirmPolicy,
  parseConfirmPolicy,
  pendingMatchesOp,
  policyAllowsOp,
} from "./confirm-policy"

describe("confirm-policy", () => {
  it("builds stable op keys", () => {
    expect(confirmOpKey("ludus", "POST", "/templates")).toBe("ludus:post:/templates")
    expect(confirmOpKey("ludus", "post", "/templates")).toBe("ludus:post:/templates")
  })

  it("matches pending by surface/method/path", () => {
    const pending = {
      surface: "ludus" as const,
      operationId: "buildTemplates",
      method: "post",
      path: "/templates",
      exp: Date.now() + 60_000,
    }
    expect(pendingMatchesOp(pending, "ludus", "POST", "/templates")).toBe(true)
    expect(pendingMatchesOp(pending, "lux", "post", "/templates")).toBe(false)
  })

  it("applies allow_op and allow_all", () => {
    const pending = {
      surface: "ludus" as const,
      operationId: "buildTemplates",
      method: "post",
      path: "/templates",
      exp: Date.now() + 60_000,
    }
    const once = applyConfirmMode(emptyConfirmPolicy(), "once", pending)
    expect(once.allowAll).toBe(false)
    expect(once.allowOps).toEqual([])

    const op = applyConfirmMode(emptyConfirmPolicy(), "allow_op", pending)
    expect(policyAllowsOp(op, "ludus", "post", "/templates")).toBe(true)
    expect(policyAllowsOp(op, "ludus", "post", "/range/deploy")).toBe(false)

    const all = applyConfirmMode(op, "allow_all", pending)
    expect(all.allowAll).toBe(true)
    expect(policyAllowsOp(all, "ludus", "post", "/range/deploy")).toBe(true)
  })

  it("parses policy json safely", () => {
    expect(parseConfirmPolicy(null)).toEqual(emptyConfirmPolicy())
    expect(parseConfirmPolicy({ allowAll: true, allowOps: ["ludus:post:/templates", 3] })).toEqual({
      allowAll: true,
      allowOps: ["ludus:post:/templates"],
    })
  })
})
