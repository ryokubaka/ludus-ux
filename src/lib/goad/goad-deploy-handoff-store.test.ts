import { mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { resetDbForTests } from "@/lib/core/db"
import { createDeployHandoff, getHandoffById, getHandoffByTaskId, linkHandoffToTask } from "@/lib/goad/goad-deploy-handoff-store"

const dataDir = mkdtempSync(path.join(os.tmpdir(), "lux-handoff-store-"))
const prevData = process.env.DATA_DIR

beforeEach(() => {
  resetDbForTests()
  process.env.DATA_DIR = dataDir
})

afterAll(() => {
  resetDbForTests()
  if (prevData === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = prevData
  rmSync(dataDir, { recursive: true, force: true })
})

describe("getHandoffByTaskId", () => {
  it("returns the wizard handoff that carries rules when execute linked one too", () => {
    const wizard = createDeployHandoff({
      rangeId: "alice-range",
      username: "alice",
      networkRulesJson: JSON.stringify({ rules: [] }),
    })
    linkHandoffToTask(wizard.id, "task-1")
    const execute = createDeployHandoff({ rangeId: "alice-range", username: "alice" })
    linkHandoffToTask(execute.id, "task-1")

    expect(getHandoffByTaskId("task-1")?.id).toBe(wizard.id)
    expect(getHandoffById(execute.id)?.username).toBe("alice")
    expect(getHandoffById("missing")).toBeNull()
  })
})
