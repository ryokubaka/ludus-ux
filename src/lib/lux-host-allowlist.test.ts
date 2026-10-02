import { spawnSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const helper = path.join(process.cwd(), "scripts/lux-host/lux-host")

function fakeRootBin(opts?: { python?: boolean }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lux-host-fake-"))
  const stub = (name: string, body: string) => {
    const file = path.join(dir, name)
    writeFileSync(file, body, { mode: 0o755 })
  }
  stub("id", "#!/bin/sh\nif [ \"$1\" = \"-u\" ]; then echo 0; exit 0; fi\nif [ \"$1\" = \"-un\" ]; then echo root; exit 0; fi\necho 0\n")
  stub("getent", "#!/bin/sh\nif [ \"$1\" = passwd ] && [ \"$2\" = luxuser ]; then echo 'luxuser:x:1000:1000::/home/luxuser:/bin/bash'; exit 0; fi\nexit 2\n")
  const names = ["pvesh", "qm", "chown", "chmod", "chpasswd", "mkdir", "rm", "find", "cat", "date", "python3", "go", "curl", "wget", "brctl", "ip", "docker", "git", "systemd-run", "base64", "install", "sudo"]
  for (const name of names) {
    if (name === "python3" && opts?.python === false) continue
    stub(name, "#!/bin/sh\necho \"$0 $*\" >> \"${LUX_HOST_STUB_LOG}\"\nexit 0\n")
  }
  return dir
}

function run(
  args: string[],
  stdin = "",
  extraEnv: Record<string, string> = {},
): { status: number; stdout: string; stderr: string; log: string } {
  const bin = fakeRootBin()
  const log = path.join(bin, "stub.log")
  writeFileSync(log, "")
  const result = spawnSync("bash", [helper, ...args], {
    input: stdin,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      LUX_HOST_STUB_LOG: log,
      ...extraEnv,
    },
  })
  let stubLog = ""
  try {
    stubLog = readFileSync(log, "utf8")
  } catch {
    stubLog = ""
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    log: stubLog,
  }
}

function denied(args: string[], stdin = "") {
  const out = run(args, stdin)
  expect(out.status, `${args.join(" ")} stderr=${out.stderr}`).toBe(2)
  expect(out.stderr).toMatch(/lux-host:/)
  expect(out.log).toBe("")
}

describe("lux-host allowlist", () => {
  it("refuses to run unless it is root", () => {
    const result = spawnSync("bash", [helper, "id"], { encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/must run as root/)
  })

  it("rejects a shell and unknown operations", () => {
    denied(["bash", "-lc", "id"])
    denied(["sh"])
    denied(["python3", "-c", "import os"])
    denied(["find", "/opt", "-exec", "id", ";"])
    denied([])
    denied(["upgrade-start"])
  })

  it("settings and credential probe", () => {
    expect(run(["version"]).stdout.trim()).toBe("4")
    expect(run(["true"]).status).toBe(0)
    expect(run(["id"]).stdout.trim()).toBe("0")
    denied(["writable-dir", "/etc"])
    denied(["writable-dir", "/opt/ludus/packer/../../etc"])
    denied(["dir-exists", "/tmp"])
    denied(["dir-exists", "/opt/ludus/packer/../secret"])
  })

  it("logs, clock, and range reconcile", () => {
    expect(run(["date-epoch"]).log).toMatch(/date/)
    denied(["range-log", "read", "../so33"])
    denied(["range-log", "read", "so33;id"])
    denied(["range-log", "tail", "so33"])
    denied(["range-log", "suffix", "so33", "-1", "10"])
    denied(["range-log", "suffix", "so33", "1", "10;id"])
  })

  it("admin vm, consoles, shared VMs, and node metrics via pvesh", () => {
    const ok = run(["pvesh", "get", "/nodes", "--output-format", "json"])
    expect(ok.status).toBe(0)
    expect(ok.log).toMatch(/pvesh get \/nodes --output-format json/)
    expect(run(["pvesh", "get", "/cluster/resources", "--type", "vm", "--output-format", "json"]).log).toMatch(/--type vm/)
    expect(run(["pvesh", "get", "/cluster/resources", "--type", "node", "--output-format", "json"]).log).toMatch(/--type node/)
    expect(run(["pvesh", "create", "/nodes/pve/qemu/108/status/start"]).status).toBe(0)
    expect(run(["pvesh", "create", "/nodes/pve/qemu/108/spiceproxy", "--proxy", "http://10.0.20.40:3128", "--output-format", "json"]).status).toBe(0)
    denied(["pvesh", "get", "/etc/passwd"])
    denied(["pvesh", "get", "/nodes/../../etc/shadow"])
    denied(["pvesh", "create", "/nodes/pve/qemu/108/status/start", "--output-format", "yaml"])
    denied(["pvesh", "delete", "/nodes/pve/qemu/108/status/stop"])
    denied(["pvesh", "exec", "/nodes"])
  })

  it("testing EFI enroll and rollback", () => {
    expect(run(["qm-config", "108"]).status).toBe(0)
    expect(run(["testing-rollback", "108", "minipve", "clean"]).status).toBe(0)
    expect(run(["testing-enroll", "108", "minipve", "1"]).status).toBe(0)
    denied(["qm-config", "0"])
    denied(["qm-config", "108;reboot"])
    denied(["testing-rollback", "108", "node;id", "clean"])
    denied(["testing-enroll", "108", "minipve", "2"])
    denied(["qm-start", "-1"])
  })

  it("templates, packer files, and source ownership", () => {
    denied(["mkdir", "/tmp/x"])
    denied(["mkdir", "/opt/ludus/packer"])
    denied(["mkdir", "/opt/ludus/packer/../../etc/cron.d"])
    denied(["rm-tree", "/opt/ludus/packer"])
    denied(["rm-tree", "/etc/passwd"])
    denied(["chown-ludus", "/opt/ludus/config.yml"])
    denied(["chmod-tree", "777", "/opt/ludus/packer/debian"])
    denied(["b64-init", "not-a-uuid"])
    denied(["b64-append", "00000000-0000-0000-0000-000000000000", "abc$()"])
    denied(["b64-finish", "00000000-0000-0000-0000-000000000000", "/opt/ludus/config.yml"])
    denied(["template-purge", "../packer"])
    denied(["template-purge", "name;rm"])
    denied(["ludus-template-add", "/tmp/t", "abcdefgh"])
    denied(["ludus-template-rm", "ok-name", "short"])
    denied(["sources-repair", "../x"])
    denied(["find-packer", "/etc"])
  })

  it("passwords, API keys, and ansible home", () => {
    denied(["chpasswd", "root"], "secret\n")
    denied(["chpasswd", "ludus"], "secret\n")
    denied(["chpasswd", "luxuser"], "has\nnewline")
    denied(["bashrc-apikey-set", "root"], "abcdefgh\n")
    denied(["bashrc-apikey-set", "luxuser"], "bad key\n")
    denied(["bashrc-apikey-get", "root"])
    denied(["ansible-home", "root"])
    denied(["ansible-home", "o'brien"])
    expect(run(["ansible-home", "luxuser"]).log).toContain("/opt/ludus/users/luxuser/.ansible")
    expect(run(["ansible-collection-file", "luxuser", "ansible", "windows", "../x"]).status).not.toBe(0)
    expect(run(["ansible-collection-file", "luxuser", "ansible", "windows", "plugins/modules/win_dns_client.ps1"]).stdout).toContain(
      "FAIL:ansible.windows",
    )
    denied(["getent-home", "root"])
  })

  it("GOAD workspace, wizard yaml, and Proxmox token", () => {
    denied(["mkdir-goad-workspace", "/opt/ludus"])
    denied(["mkdir-goad-workspace", "/opt/ludus/ranges"])
    denied(["mkdir-goad-workspace", "/etc"])
    denied(["prepare-goad-submodule", "/opt/ludus", "luxuser"])
    denied(["prepare-goad-submodule", "/etc", "luxuser"])
    denied(["prepare-goad-submodule", "/opt/GOAD", "root"])
    denied(["prepare-goad-submodule", "/opt/GOAD"])
    denied(["chown-goad", "root", "/opt/GOAD", "inst"])
    denied(["chown-goad", "luxuser", "/opt/ludus/packer", "inst"])
    denied(["chown-goad", "luxuser", "/opt/GOAD", "../x"])
    denied(["wizard-yaml", "not-uuid"], "key: value\n")
    denied(["wizard-reap", "extra"])
    expect(run(["proxmox-token"]).status).not.toBe(2)
  })

  it("LudusHound Go install and platform requirements", () => {
    denied(["install-go", "1.24"])
    denied(["install-go", "1.24.5;id"])
    denied(["install-go", "1.24.5rc1"])
    expect(run(["install-go", "1.24.5"]).stdout).toMatch(/GO_OK/)
    expect(run(["read-ludus-requirements"]).status).not.toBe(2)
  })

  it("in-app upgrade arguments", () => {
    denied(["upgrade-start", "/opt/ludus-ux", "main"])
    denied(["upgrade-start", "/opt/ludus-ux", "v1.3.3;id"])
    denied(["upgrade-start", "relative", "v1.3.3"])
    denied(["upgrade-probe", "/tmp/not-lux;id"])
  })

  it("runs a signed stdin upgrade script from a root-owned temp file and refuses a caller-writable checkout script", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "lux-upgrade-owned-"))
    mkdirSync(path.join(repo, "scripts"), { recursive: true })
    mkdirSync(path.join(repo, "data"), { recursive: true })
    writeFileSync(path.join(repo, "docker-compose.yml"), "services: {}\n")
    writeFileSync(path.join(repo, "scripts/upgrade.sh"), "#!/bin/sh\necho checkout\n", { mode: 0o755 })
    const env = { SUDO_USER: "ludus" }
    const key = "ab".repeat(32)
    const body = "#!/usr/bin/env bash\nexit 0\n"
    const unsigned = "#!/bin/bash\necho from-stdin\n"
    const sign = (text: string, macKey: string) =>
      `${createHmac("sha256", macKey).update(text).digest("hex")}\n${text}`

    const refusedProbe = run(["upgrade-probe", repo], "", env)
    expect(refusedProbe.status).toBe(2)
    expect(refusedProbe.stderr).toMatch(/writable by the caller/)
    expect(refusedProbe.stdout).not.toMatch(/^ok=yes$/m)

    const refusedStart = run(["upgrade-start", repo, "v1.4.0"], "", env)
    expect(refusedStart.status).toBe(2)
    expect(refusedStart.stderr).toMatch(/writable by the caller/)
    expect(refusedStart.log).not.toContain("systemd-run")

    const unsignedProbe = runUpgrade(["upgrade-probe", repo], unsigned, key)
    expect(unsignedProbe.status).toBe(2)
    expect(unsignedProbe.stderr).toMatch(/hmac/)
    expect(unsignedProbe.stdout).not.toMatch(/^ok=yes$/m)
    expect(unsignedProbe.log).not.toContain("systemd-run")
    expect(unsignedProbe.log).not.toContain("from-stdin")

    const badMac = runUpgrade(["upgrade-start", repo, "v1.4.0"], sign(body, "cd".repeat(32)), key)
    expect(badMac.status).toBe(2)
    expect(badMac.stderr).toMatch(/hmac/)
    expect(badMac.log).not.toContain("systemd-run")

    const missingKey = runUpgrade(["upgrade-probe", repo], sign(body, key), null)
    expect(missingKey.status).toBe(2)
    expect(missingKey.stderr).toMatch(/update key/)
    expect(missingKey.stdout).not.toMatch(/^ok=yes$/m)

    const probed = runUpgrade(["upgrade-probe", repo], sign(body, key), key)
    expect(probed.status, probed.stderr).toBe(0)
    expect(probed.stdout).toMatch(/^ok=yes$/m)
    expect(probed.log).not.toContain("systemd-run")

    const started = runUpgrade(["upgrade-start", repo, "v1.4.0"], sign(body, key), key)
    expect(started.status, started.stderr).toBe(0)
    expect(started.stdout.trim()).toBe("started")
    const script = /LUX_UPGRADE_SCRIPT=(\S+)/.exec(started.log)?.[1]
    expect(script).toBeTruthy()
    expect(script).not.toBe(path.join(repo, "scripts/upgrade.sh"))
    expect(readFileSync(script!, "utf8")).toBe(body)
    expect(started.log).not.toContain("from-stdin")
    expect(started.log).not.toContain(path.join(repo, "scripts/upgrade.sh"))
    expect(started.log).toContain('bash "$LUX_UPGRADE_SCRIPT"')
  })
})

function runUpgrade(
  args: string[],
  stdin: string,
  updateKey: string | null,
): { status: number; stdout: string; stderr: string; log: string } {
  const bin = fakeRootBin({ python: false })
  const log = path.join(bin, "stub.log")
  writeFileSync(log, "")
  const script = `
set -e
mount -t tmpfs tmpfs /etc
if [ -n "$LUX_TEST_UPDATE_KEY" ]; then
  printf '%s' "$LUX_TEST_UPDATE_KEY" > /etc/lux-host.update-key
fi
exec bash ${JSON.stringify(helper)} "$@"
`
  const result = spawnSync(
    "unshare",
    ["--user", "--map-root-user", "--mount", "bash", "-c", script, "bash", ...args],
    {
      input: stdin,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        LUX_HOST_STUB_LOG: log,
        LUX_TEST_UPDATE_KEY: updateKey ?? "",
        SUDO_USER: "ludus",
      },
    },
  )
  let stubLog = ""
  try {
    stubLog = readFileSync(log, "utf8")
  } catch {
    stubLog = ""
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    log: stubLog,
  }
}
