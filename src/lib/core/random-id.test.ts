import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { newGoadTaskId } from "@/lib/goad/goad-task-store"
import { newRangeUid } from "@/lib/range/range-uid"

describe("random ids", () => {
  it("keeps the task id and range uid charset and does not use Math.random", () => {
    expect(newGoadTaskId(1_700_000_000_000)).toMatch(/^goad-1700000000000-[0-9a-z]{4}$/)
    expect(newRangeUid()).toMatch(/^[0-9A-Z]{6}$/)
    for (const file of ["src/lib/goad/goad-task-store.ts", "src/lib/range/range-uid.ts", "src/app/goad/new/_new.tsx"]) {
      expect(readFileSync(path.join(process.cwd(), file), "utf8")).not.toContain("Math.random")
    }
  })
})
