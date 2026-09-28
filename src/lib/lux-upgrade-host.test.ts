import { execFileSync, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { luxUpgradeFailureFromLog } from "./lux-version"
import {
  buildHostProbeCmd,
  buildStartUpgradeCmd,
  isSafeLuxRepoPath,
  parseHostProbe,
  readLuxUpgradeLogTail,
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
      env: { PATH: `${bin}:/usr/bin:/bin`, NODE_ENV: "test" },
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
      env: { PATH: `${bin}:/usr/bin:/bin`, NODE_ENV: "test" },
    })
    expect(result.status).not.toBe(0)
    expect(result.stdout ?? "").not.toMatch(/\bstarted\b/)
  })

  it("refuses to start an upgrade with a bad tag or path", () => {
    expect(() => buildStartUpgradeCmd("/opt/ludus-ux", "v1.3.3;rm")).toThrow("Invalid release tag")
    expect(() => buildStartUpgradeCmd("/opt/ludus-ux", "main")).toThrow("Invalid release tag")
    expect(() => buildStartUpgradeCmd("/opt/../tmp", "v1.3.3")).toThrow("Unsafe repository path")
  })

  it("trusts only this clone when root git would otherwise refuse it, and reports a dirty tree", () => {
    const repo = realpathSync(mkdtempSync(path.join(tmpdir(), "lux-probe-owned-")))
    const bin = path.join(repo, "bin")
    const log = path.join(repo, "git.args")
    mkdirSync(path.join(repo, "scripts"))
    mkdirSync(bin)
    mkdirSync(path.join(repo, ".git"))
    writeFileSync(path.join(repo, "docker-compose.yml"), "services: {}\n")
    writeFileSync(path.join(repo, "scripts/upgrade.sh"), "#!/bin/sh\nexit 0\n")
    writeFileSync(path.join(repo, "README"), "dirty\n")
    writeFileSync(
      path.join(bin, "git"),
      `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
found=
i=0
count=\${GIT_CONFIG_COUNT:-0}
while [ "$i" -lt "$count" ]; do
  eval "key=\\$GIT_CONFIG_KEY_$i"
  eval "val=\\$GIT_CONFIG_VALUE_$i"
  if [ "$key" = "safe.directory" ] && [ "$val" = "*" ]; then
    echo "fatal: wildcard safe.directory" >&2
    exit 1
  fi
  if [ "$key" = "safe.directory" ] && [ "$val" = ${JSON.stringify(repo)} ]; then found=1; fi
  i=$((i + 1))
done
case "$*" in
  *"--global"*) echo "fatal: global git config" >&2; exit 1 ;;
esac
if [ "$found" != 1 ]; then
  echo "fatal: detected dubious ownership in repository" >&2
  exit 128
fi
case "$1" in
  rev-parse)
    if [ "$2" = "--is-inside-work-tree" ]; then exit 0; fi
    if [ "$2" = "--abbrev-ref" ]; then printf 'main\\n'; exit 0; fi
    exit 1
    ;;
  status)
    printf ' M README\\n'
    exit 0
    ;;
  describe)
    exit 1
    ;;
esac
exit 1
`,
      { mode: 0o755 },
    )
    chmodSync(path.join(bin, "git"), 0o755)
    const out = execFileSync("bash", ["-c", buildHostProbeCmd(repo)], {
      encoding: "utf8",
      env: gitEnv(bin),
    })
    expect(parseHostProbe(out)).toMatchObject({
      canSwitch: true,
      repoPath: repo,
      dirty: true,
      checkout: "main",
      reason: null,
    })
    expect(readFileSync(log, "utf8")).not.toContain("--global")
  })

  it("keeps upgrade disabled when git still cannot read the clone", () => {
    const repo = realpathSync(mkdtempSync(path.join(tmpdir(), "lux-probe-refused-")))
    const bin = path.join(repo, "bin")
    mkdirSync(path.join(repo, "scripts"))
    mkdirSync(bin)
    mkdirSync(path.join(repo, ".git"))
    writeFileSync(path.join(repo, "docker-compose.yml"), "services: {}\n")
    writeFileSync(path.join(repo, "scripts/upgrade.sh"), "#!/bin/sh\nexit 0\n")
    writeFileSync(
      path.join(bin, "git"),
      "#!/bin/sh\necho 'fatal: detected dubious ownership in repository' >&2\nexit 128\n",
      { mode: 0o755 },
    )
    chmodSync(path.join(bin, "git"), 0o755)
    const out = execFileSync("bash", ["-c", buildHostProbeCmd(repo)], {
      encoding: "utf8",
      env: gitEnv(bin),
    })
    const cap = parseHostProbe(out)
    expect(cap.canSwitch).toBe(false)
    expect(cap.dirty).toBe(false)
    expect(cap.repoPath).toBe(repo)
    expect(cap.reason).toMatch(/Git could not read this clone/)
  })

  it("reports a failed switch when the build log is longer than the tail", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-upgrade-log-"))
    const file = path.join(dir, "lux-upgrade.log")
    const marker = "=== LUX switch to v1.3.2 started 2026-09-28T00:00:00Z ===\n"
    const error = "Error: tag 'v1.3.2' not found after fetch.\n"
    const build = "Step 12/40 : RUN npm run build\n".repeat(400)
    const exit = "LUX_UPGRADE_EXIT:1\n"
    const early = marker + error + build + exit
    expect(early.length).toBeGreaterThan(8000)
    writeFileSync(file, early)

    const earlyTail = readLuxUpgradeLogTail(8000, file)
    expect(earlyTail.length).toBeLessThan(early.length)
    expect(luxUpgradeFailureFromLog(earlyTail, "v1.3.2")).toBe(
      "Error: tag 'v1.3.2' not found after fetch.",
    )
    expect(luxUpgradeFailureFromLog(earlyTail, "v1.3.4")).toBeNull()

    const late = `${marker}${build}Error: compose build failed\n${exit}`
    writeFileSync(file, late)
    expect(luxUpgradeFailureFromLog(readLuxUpgradeLogTail(8000, file), "v1.3.2")).toBe(
      "Error: compose build failed",
    )

    writeFileSync(file, `${marker}${build}LUX_UPGRADE_EXIT:0\n`)
    expect(luxUpgradeFailureFromLog(readLuxUpgradeLogTail(8000, file), "v1.3.2")).toBeNull()

    const short = marker + error + exit
    writeFileSync(file, short)
    expect(readLuxUpgradeLogTail(8000, file)).toBe(short)
  })

  it("keeps the latest start line and does not reuse an older exit status", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-upgrade-log-"))
    const file = path.join(dir, "lux-upgrade.log")
    const older =
      "=== LUX switch to v1.3.0 started 2026-09-27T00:00:00Z ===\n" +
      "old\n".repeat(5000) +
      "LUX_UPGRADE_EXIT:1\n"
    const newer =
      "=== LUX switch to v1.3.2 started 2026-09-28T00:00:00Z ===\nError: boom\nLUX_UPGRADE_EXIT:1\n"
    writeFileSync(file, older + newer)
    const tail = readLuxUpgradeLogTail(8000, file)
    expect(luxUpgradeFailureFromLog(tail, "v1.3.2")).toBe("Error: boom")
    expect(luxUpgradeFailureFromLog(tail, "v1.3.0")).toBeNull()

    const stillRunning =
      older + "=== LUX switch to v1.3.2 started 2026-09-28T00:00:00Z ===\n" + "build\n".repeat(5000)
    writeFileSync(file, stillRunning)
    expect(luxUpgradeFailureFromLog(readLuxUpgradeLogTail(8000, file), "v1.3.2")).toBeNull()

    const marker = "=== LUX switch to v1.3.2 started 2026-09-28T00:00:00Z ===\n"
    const exit = "LUX_UPGRADE_EXIT:1\n"
    writeFileSync(file, marker + "build\n".repeat(5000) + exit)
    expect(marker.length).toBeLessThan(60)
    expect(marker.length + exit.length).toBeGreaterThan(60)
    expect(luxUpgradeFailureFromLog(readLuxUpgradeLogTail(60, file), "v1.3.2")).toBe(
      "Version switch exited 1",
    )
  })

  it("sees a dirty file in a real clone the current user owns", () => {
    const repo = realpathSync(mkdtempSync(path.join(tmpdir(), "lux-probe-real-")))
    mkdirSync(path.join(repo, "scripts"))
    writeFileSync(path.join(repo, "docker-compose.yml"), "services: {}\n")
    writeFileSync(path.join(repo, "scripts/upgrade.sh"), "#!/bin/sh\nexit 0\n")
    execFileSync("git", ["init", "-q"], { cwd: repo })
    writeFileSync(path.join(repo, "README"), "dirty\n")
    const out = execFileSync("bash", ["-c", buildHostProbeCmd(repo)], {
      encoding: "utf8",
      env: gitEnv(""),
    })
    const cap = parseHostProbe(out)
    expect(cap.canSwitch).toBe(true)
    expect(cap.dirty).toBe(true)
    expect(cap.repoPath).toBe(repo)
    expect(cap.reason).toBeNull()
  })
})

function gitEnv(bin: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (bin) env.PATH = `${bin}${path.delimiter}${env.PATH ?? ""}`
  delete env.GIT_CONFIG_COUNT
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key]
  }
  return env
}

describe("upgrade.sh dubious ownership", () => {
  it("marks this clone safe for the switch and stops when git still refuses it", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lux-upgrade-sh-")))
    const bin = path.join(root, "bin")
    const log = path.join(root, "git.args")
    mkdirSync(path.join(root, "scripts"))
    mkdirSync(bin)
    writeFileSync(path.join(root, "docker-compose.yml"), "services: {}\n")
    copyFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/upgrade.sh"),
      path.join(root, "scripts/upgrade.sh"),
    )
    writeFileSync(
      path.join(bin, "git"),
      `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  *"--global"*|config*) echo "fatal: global git config" >&2; exit 1 ;;
esac
found=
i=0
count=\${GIT_CONFIG_COUNT:-0}
while [ "$i" -lt "$count" ]; do
  eval "key=\\$GIT_CONFIG_KEY_$i"
  eval "val=\\$GIT_CONFIG_VALUE_$i"
  if [ "$key" = "safe.directory" ] && [ "$val" = "*" ]; then
    echo "fatal: wildcard safe.directory" >&2
    exit 1
  fi
  if [ "$key" = "safe.directory" ] && [ "$val" = ${JSON.stringify(root)} ]; then found=1; fi
  i=$((i + 1))
done
if [ "$found" != 1 ]; then
  echo "fatal: detected dubious ownership in repository" >&2
  exit 128
fi
case "$1" in
  rev-parse) exit 0 ;;
esac
exit 0
`,
      { mode: 0o755 },
    )
    writeFileSync(
      path.join(bin, "docker"),
      `#!/bin/sh\nprintf '%s\\n' "docker $*" >> ${JSON.stringify(log)}\nexit 1\n`,
      { mode: 0o755 },
    )
    writeFileSync(path.join(bin, "docker-compose"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
    chmodSync(path.join(bin, "git"), 0o755)
    chmodSync(path.join(bin, "docker"), 0o755)
    chmodSync(path.join(bin, "docker-compose"), 0o755)
    const trusted = spawnSync("bash", [path.join(root, "scripts/upgrade.sh")], {
      encoding: "utf8",
      env: gitEnv(bin),
    })
    const trustedText = `${trusted.stdout ?? ""}${trusted.stderr ?? ""}`
    const trustedLog = readFileSync(log, "utf8")
    expect(trusted.status).not.toBe(0)
    expect(trustedText).not.toMatch(/not a git repository/)
    expect(trustedText).not.toMatch(/another user owns it/)
    expect(trustedLog).toContain("rev-parse --is-inside-work-tree")
    expect(trustedLog).toContain("docker compose version")
    expect(trustedLog).not.toContain("--global")

    writeFileSync(log, "")
    writeFileSync(path.join(bin, "git"), "#!/bin/sh\necho 'fatal: detected dubious ownership in repository' >&2\nexit 128\n", {
      mode: 0o755,
    })
    chmodSync(path.join(bin, "git"), 0o755)
    const refused = spawnSync("bash", [path.join(root, "scripts/upgrade.sh")], {
      encoding: "utf8",
      env: gitEnv(bin),
    })
    const refusedText = `${refused.stdout ?? ""}${refused.stderr ?? ""}`
    expect(refused.status).not.toBe(0)
    expect(refusedText).toMatch(/another user owns it/)
    expect(refusedText).not.toMatch(/Checking out/)
    expect(readFileSync(log, "utf8")).toBe("")
  })
})
