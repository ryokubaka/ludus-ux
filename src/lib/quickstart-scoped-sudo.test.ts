import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const quickstart = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/quickstart.sh")

function offerInstall(fakeRoot: boolean): { status: number; output: string; calls: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "lux-qs-"))
  const keys = path.join(dir, "keys")
  const bin = path.join(dir, "bin")
  const callLog = path.join(dir, "ssh-calls")
  mkdirSync(keys)
  mkdirSync(bin)
  writeFileSync(path.join(keys, "id_rsa"), "not-a-real-key\n")
  writeFileSync(
    path.join(dir, ".env"),
    [
      "LUDUS_SSH_HOST=127.0.0.1",
      "LUDUS_SSH_PORT=22",
      "PROXMOX_SSH_USER=testuser",
      `SSH_KEY_PATH=${keys}`,
      "",
    ].join("\n"),
  )
  writeFileSync(
    path.join(bin, "ssh"),
    `#!/bin/bash
cmd="\${@: -1}"
printf '%s\\n' "$cmd" >> ${JSON.stringify(callLog)}
if [[ "$cmd" == "true" || "$cmd" == "sudo -n true" ]]; then
  exit 0
fi
if [[ "$cmd" == *"visudo"* || "$cmd" == *"bash -c"* ]]; then
  exit 1
fi
if [[ "$cmd" == *"lux-host"* ]]; then
  echo 0
  exit 0
fi
if [[ "$cmd" == *"id -u"* ]]; then
  if [[ "\${FAKE_ROOT}" == "1" ]]; then exit 0; fi
  exit 1
fi
exit 1
`,
    { mode: 0o755 },
  )
  const result = spawnSync(
    "bash",
    [
      "-c",
      `
set +e
source ${JSON.stringify(quickstart)}
set +e
cd ${JSON.stringify(dir)}
set -e
status=0
lux_offer_scoped_host_sudo testuser || status=$?
printf '%s' "$status"
`,
    ],
    {
      encoding: "utf8",
      input: "\n",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_ROOT: fakeRoot ? "1" : "0",
      },
    },
  )
  const calls = readFileSync(callLog, "utf8")
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  const statusText = (result.stdout ?? "").trim().split("\n").pop() ?? ""
  return { status: Number(statusText), output: text, calls }
}

describe("lux_offer_scoped_host_sudo", () => {
  it("does not report success when the root install fails", () => {
    const result = offerInstall(true)
    expect(result.status).toBe(1)
    expect(result.output).not.toContain("Installed.")
    expect(result.output).toContain("sudoers install failed")
    expect(result.calls).not.toContain("lux-host 'id -u'")
  })

  it("does not report success when the passwordless sudo install fails", () => {
    const result = offerInstall(false)
    expect(result.status).toBe(1)
    expect(result.output).not.toContain("Installed.")
    expect(result.output).toContain("sudoers install failed")
    expect(result.calls).not.toContain("lux-host 'id -u'")
  })
})
