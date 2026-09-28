import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildHostProbeCmd,
  buildStartUpgradeCmd,
  isSafeLuxRepoPath,
  parseHostProbe,
} from "./lux-upgrade-host"

describe("lux-upgrade-host", () => {
  it("accepts absolute host paths and rejects injection", () => {
    expect(isSafeLuxRepoPath("/opt/ludus-ux")).toBe(true)
    expect(isSafeLuxRepoPath("/home/user/ludus-ux")).toBe(true)
    expect(isSafeLuxRepoPath("ludus-ux")).toBe(false)
    expect(isSafeLuxRepoPath("/opt/../etc")).toBe(false)
    expect(isSafeLuxRepoPath("/opt/ludus-ux;rm -rf /")).toBe(false)
    expect(isSafeLuxRepoPath("/opt/ludus-ux$(id)")).toBe(false)
    expect(isSafeLuxRepoPath("/opt/ludus-ux\n/tmp")).toBe(false)
  })

  it("quotes the explicit repo path in the probe command", () => {
    const cmd = buildHostProbeCmd("/opt/ludus-ux")
    expect(cmd.startsWith("PROVIDED='/opt/ludus-ux'")).toBe(true)
    expect(cmd).not.toContain("PROVIDED=/opt/ludus-ux;")
  })

  it("parses a ready host probe when the tty added carriage returns", () => {
    const cap = parseHostProbe(
      ["repo=/opt/ludus-ux", "compose=yes", "script=yes", "git=yes", "dirty=yes", "checkout=v1.3.2", "ok=yes"].join(
        "\r\n",
      ) + "\r\n",
    )
    expect(cap).toEqual({
      canSwitch: true,
      repoPath: "/opt/ludus-ux",
      dirty: true,
      checkout: "v1.3.2",
      reason: null,
    })
  })

  it("parses a ready host probe", () => {
    const cap = parseHostProbe(
      [
        "repo=/opt/ludus-ux",
        "compose=yes",
        "script=yes",
        "git=yes",
        "dirty=no",
        "checkout=v1.3.2",
        "ok=yes",
      ].join("\n"),
    )
    expect(cap).toEqual({
      canSwitch: true,
      repoPath: "/opt/ludus-ux",
      dirty: false,
      checkout: "v1.3.2",
      reason: null,
    })
  })

  it("rejects a missing or unsafe repo from probe output", () => {
    const missing = parseHostProbe("repo=\nok=no\nreason=not_found\n")
    expect(missing.canSwitch).toBe(false)
    expect(missing.repoPath).toBeNull()

    const injected = parseHostProbe("repo=/opt/ludus-ux;rm -rf /\ncompose=yes\nscript=yes\ngit=yes\n")
    expect(injected.canSwitch).toBe(false)
    expect(injected.repoPath).toBeNull()
  })

  it("queues the upgrade with systemd-run and reports started only after that returns", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-upgrade-"))
    const data = path.join(dir, "data")
    const bin = path.join(dir, "bin")
    const argLog = path.join(dir, "systemd-run.args")
    mkdirSync(bin)
    writeFileSync(path.join(bin, "docker"), `#!/bin/sh\nprintf '%s' ${JSON.stringify(data)}\n`, { mode: 0o755 })
    writeFileSync(
      path.join(bin, "systemd-run"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argLog)}\nsleep 0.3\nexit 0\n`,
      { mode: 0o755 },
    )
    chmodSync(path.join(bin, "docker"), 0o755)
    chmodSync(path.join(bin, "systemd-run"), 0o755)
    const cmd = buildStartUpgradeCmd("/opt/ludus-ux", "v1.3.3")
    const started = Date.now()
    const out = execFileSync("bash", ["-c", cmd], {
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin` },
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
    expect(out.trim()).toBe("started")
    const args = readFileSync(argLog, "utf8").split("\n").filter(Boolean)
    expect(args).toContain("--collect")
    expect(args).not.toContain("--wait")
    expect(args).not.toContain("--scope")
    expect(args).toContain("--setenv=REPO=/opt/ludus-ux")
    expect(args).toContain("--setenv=TAG=v1.3.3")
    expect(args).toContain("--setenv=LUX_UPGRADE_YES=1")
    expect(args.some((arg) => arg.includes("scripts/upgrade.sh") && arg.includes("LUX_UPGRADE_EXIT:"))).toBe(true)
    expect(readFileSync(path.join(data, "lux-upgrade.log"), "utf8")).toContain("v1.3.3")
  })

  it("does not report started when systemd-run fails", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-upgrade-fail-"))
    const bin = path.join(dir, "bin")
    mkdirSync(bin)
    writeFileSync(path.join(bin, "docker"), `#!/bin/sh\nprintf '%s' ${JSON.stringify(path.join(dir, "data"))}\n`, {
      mode: 0o755,
    })
    writeFileSync(path.join(bin, "systemd-run"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
    const result = spawnSync("bash", ["-c", buildStartUpgradeCmd("/opt/ludus-ux", "v1.3.3")], {
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin` },
    })
    expect(result.status).not.toBe(0)
    expect(result.stdout ?? "").not.toMatch(/\bstarted\b/)
  })

  it("refuses to start an upgrade with a bad tag or path", () => {
    expect(() => buildStartUpgradeCmd("/opt/ludus-ux", "v1.3.3;rm")).toThrow("Invalid release tag")
    expect(() => buildStartUpgradeCmd("/opt/ludus-ux", "main")).toThrow("Invalid release tag")
    expect(() => buildStartUpgradeCmd("/opt/../tmp", "v1.3.3")).toThrow("Unsafe repository path")
  })
})
