import { spawnSync } from "child_process"
import { closeSync, fstatSync, openSync, readFileSync, rmSync, statSync } from "fs"
import { describe, expect, it } from "vitest"
import { buildGoadEnvFileStep, GOAD_ENV_FILE_PATTERN, sourceGoadEnvFile } from "@/lib/goad/goad-ssh"

const exportLines = ["export PYTHONUNBUFFERED=1", "export LUDUS_API_KEY='alice.k'\\''ey$(id)'"]

describe("buildGoadEnvFileStep", () => {
  it("keeps the export lines on stdin for every way GOAD runs", () => {
    const own = buildGoadEnvFileStep({ exportLines, hostUser: "root" })
    expect(own.command).toBe("bash -s")
    const viaRoot = buildGoadEnvFileStep({ exportLines, impersonateAs: "bob", hostUser: "root" })
    expect(viaRoot.command).toBe("sudo -H -u 'bob' bash -s")
    const viaLuxHost = buildGoadEnvFileStep({ exportLines, impersonateAs: "bob", hostUser: "ludus" })
    expect(viaLuxHost.command).toMatch(/lux-host 'run-as-user' 'bob'/)
    for (const step of [own, viaRoot, viaLuxHost]) {
      expect(step.command).not.toContain("alice")
      expect(step.stdin).toContain(exportLines[1])
    }
    expect(() => buildGoadEnvFileStep({ exportLines, impersonateAs: "root", hostUser: "ludus" })).toThrow()
  })

  it("only sources a path the step created", () => {
    expect(sourceGoadEnvFile("/tmp/lux-goad-env.Ab12Cd34")).toBe(
      ". '/tmp/lux-goad-env.Ab12Cd34'; rm -f '/tmp/lux-goad-env.Ab12Cd34'",
    )
    expect(() => sourceGoadEnvFile("/tmp/x'; rm -rf /; '")).toThrow()
  })

  it.skipIf(process.platform === "win32")("writes a 0600 file that a shell can source", () => {
    const step = buildGoadEnvFileStep({ exportLines, hostUser: "root" })
    const created = spawnSync("bash", ["-s"], { input: step.stdin, encoding: "utf8" })
    expect(created.status).toBe(0)
    const file = created.stdout.trim()
    expect(file).toMatch(GOAD_ENV_FILE_PATTERN)
    try {
      const fd = openSync(file, "r")
      try {
        expect(fstatSync(fd).mode & 0o777).toBe(0o600)
        expect(readFileSync(fd, "utf8")).toContain(exportLines[1])
      } finally {
        closeSync(fd)
      }
      const sourced = spawnSync("bash", ["-c", `${sourceGoadEnvFile(file)}; printf '%s' "$LUDUS_API_KEY"`], {
        encoding: "utf8",
      })
      expect(sourced.stdout).toBe("alice.k'ey$(id)")
      expect(() => statSync(file)).toThrow()
    } finally {
      rmSync(file, { force: true })
    }
  })
})
