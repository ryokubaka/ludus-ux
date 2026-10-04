import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { buildHostProbeCmd, parseHostProbe } from "./lux-upgrade-host"
import { sshLoginCommand } from "./proxmox-ssh"

describe("sshLoginCommand", () => {
  it("keeps probe assignments from being expanded by the outer shell", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "lux-probe-"))
    mkdirSync(path.join(repo, "scripts"))
    writeFileSync(path.join(repo, "docker-compose.yml"), "services: {}\n")
    writeFileSync(path.join(repo, "scripts", "upgrade.sh"), "#!/bin/sh\nexit 0\n")
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" })
    const wrapped = sshLoginCommand(buildHostProbeCmd(repo))
    const out = execFileSync("sh", ["-c", wrapped], {
      encoding: "utf8",
      env: { ...process.env, PROVIDED: "", REPO: "LEAKED" },
    })
    const cap = parseHostProbe(out)
    expect(cap.canSwitch).toBe(true)
    expect(cap.repoPath).toBe(repo)
  })

  it("leaves stdin on the remote script", () => {
    const wrapped = sshLoginCommand(`IFS= read -r line; printf '%s' "$line"`)
    const out = execFileSync("sh", ["-c", wrapped], { encoding: "utf8", input: "secret-once\n" })
    expect(out).toBe("secret-once")
  })
})
