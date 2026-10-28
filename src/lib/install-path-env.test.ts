import { afterEach, describe, expect, it } from "vitest"
import { goadPathFromEnv, ludusInstallPathFromEnv } from "./install-path-env"

describe("install-path-env", () => {
  const priorGoad = process.env.GOAD_PATH
  const priorLudus = process.env.LUDUS_INSTALL_PATH

  afterEach(() => {
    if (priorGoad === undefined) delete process.env.GOAD_PATH
    else process.env.GOAD_PATH = priorGoad
    if (priorLudus === undefined) delete process.env.LUDUS_INSTALL_PATH
    else process.env.LUDUS_INSTALL_PATH = priorLudus
  })

  it("reads GOAD_PATH from the environment", () => {
    process.env.GOAD_PATH = "/data/goad"
    expect(goadPathFromEnv()).toBe("/data/goad")
  })

  it("reads LUDUS_INSTALL_PATH from the environment", () => {
    process.env.LUDUS_INSTALL_PATH = "/data/ludus"
    expect(ludusInstallPathFromEnv()).toBe("/data/ludus")
  })
})
