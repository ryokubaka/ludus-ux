import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { buildHostProbeCmd, normalizeLuxHostRepoPath, parseHostProbe } from "./lux-upgrade-host"
import { sshLoginCommand } from "./proxmox-ssh"

describe("sshLoginCommand", () => {
  it("keeps probe assignments from being expanded by the outer shell", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "lux-probe-"))
    mkdirSync(path.join(repo, "scripts"))
    writeFileSync(path.join(repo, "docker-compose.yml"), "services: {}\n")
    writeFileSync(path.join(repo, "scripts", "upgrade.sh"), "#!/bin/sh\nexit 0\n")
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" })
    const dockerStub = mkdtempSync(path.join(tmpdir(), "lux-docker-stub-"))
    writeFileSync(path.join(dockerStub, "docker"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    chmodSync(path.join(dockerStub, "docker"), 0o755)
    const wrapped = sshLoginCommand(
      buildHostProbeCmd({ containerRef: "ludus-ux", candidates: [repo] }),
    )
    const out = execFileSync("bash", ["--norc", "--noprofile", "-c", wrapped], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dockerStub}${path.delimiter}${process.env.PATH ?? ""}`,
        DOCKER_HOST: "unix:///tmp/lux-probe-no-docker.sock",
        PROVIDED: "",
        REPO: "LEAKED",
      },
    })
    const cap = parseHostProbe(out)
    expect(cap.canSwitch).toBe(true)
    expect(cap.repoPath).toBe(normalizeLuxHostRepoPath(repo))
  })

  it("leaves stdin on the remote script", () => {
    const wrapped = sshLoginCommand(`IFS= read -r line; printf '%s' "$line"`)
    const out = execFileSync("sh", ["-c", wrapped], { encoding: "utf8", input: "secret-once\n" })
    expect(out).toBe("secret-once")
  })
})
