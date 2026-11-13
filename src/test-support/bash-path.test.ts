import path from "node:path"
import { describe, expect, it } from "vitest"
import { bashPathInherit, posixPath } from "@/test-support/bash-path"

describe("bashPath", () => {
  it("leaves a Linux path alone", () => {
    expect(posixPath("/tmp/lux-bin", "linux")).toBe("/tmp/lux-bin")
  })

  it("turns a Windows drive path into a Git Bash path", () => {
    expect(posixPath("C:\\Users\\crt\\AppData\\Local\\Temp\\lux-bin", "win32")).toBe(
      "/c/Users/crt/AppData/Local/Temp/lux-bin",
    )
  })

  it("prepends a directory with the platform PATH delimiter", () => {
    const prev = process.env.PATH
    process.env.PATH = "/usr/bin:/bin"
    try {
      expect(bashPathInherit("/tmp/fake")).toBe(`/tmp/fake${path.delimiter}/usr/bin:/bin`)
    } finally {
      process.env.PATH = prev
    }
  })
})
