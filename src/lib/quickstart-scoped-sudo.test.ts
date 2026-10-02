import { spawnSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { decryptSettingsValueAtRest } from "./settings-value-at-rest"

const quickstart = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/quickstart.sh")

function offerInstall(
  fakeRoot: boolean,
  fakeHelper = false,
  apply = false,
): { status: number; output: string; calls: string; dir: string; keyFile: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "lux-qs-"))
  const keys = path.join(dir, "keys")
  const bin = path.join(dir, "bin")
  const callLog = path.join(dir, "ssh-calls")
  const keyFile = path.join(dir, "update-key")
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
      "APP_SECRET=unit-test-app-secret-32-characters",
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
case "$cmd" in
  "sudo -n /usr/local/sbin/lux-host true")
    if [[ "\${FAKE_HELPER}" == "1" ]]; then exit 0; fi
    exit 1
    ;;
  "sudo -n /usr/local/sbin/lux-host "*)
    if [[ "\${FAKE_HELPER}" == "1" ]]; then
      if [[ "$cmd" == *"'id -u'"* || "$cmd" == *"lux-host id" ]]; then echo 0; fi
      exit 0
    fi
    ;;
esac
if [[ "\${FAKE_APPLY}" == "1" && "$cmd" == "bash -c "* ]]; then
  unshare --user --map-root-user --mount bash -c '
    set -euo pipefail
    mount -t tmpfs tmpfs /etc
    mkdir -p /etc/sudoers.d
    echo 'root:x:0:0:root:/root:/bin/bash' > /etc/passwd
    echo 'root:x:0:' > /etc/group
    mount -t tmpfs tmpfs /usr/local
    mkdir -p /usr/local/sbin
    export PATH="/usr/sbin:/usr/bin:/bin"
    eval "$1"
    cat /etc/lux-host.update-key
  ' bash "$cmd" > ${JSON.stringify(keyFile)}
  exit $?
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
        FAKE_HELPER: fakeHelper ? "1" : "0",
        FAKE_APPLY: apply ? "1" : "0",
        DATA_DIR: dir,
      },
    },
  )
  const calls = readFileSync(callLog, "utf8")
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  const statusText = (result.stdout ?? "").trim().split("\n").pop() ?? ""
  return { status: Number(statusText), output: text, calls, dir, keyFile }
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

  it("writes the update key and stores it for Settings when the root install runs", () => {
    const result = offerInstall(true, false, true)
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain("Installed.")
    const secret = "unit-test-app-secret-32-characters"
    const key = readFileSync(result.keyFile, "utf8").trim().split("\n").pop() ?? ""
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(result.output).not.toContain(key)
    const db = new DatabaseSync(path.join(result.dir, "ludus-ux.db"))
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("luxHostUpdateKey") as { value: string }
    db.close()
    expect(decryptSettingsValueAtRest(row.value, secret)).toBe(key)
  })

  it("refreshes the helper through lux-host when sudo -n true is denied", () => {
    const result = offerInstall(false, true)
    expect(result.status).toBe(0)
    expect(result.output).toContain("Installed.")
    expect(result.calls).toContain("sudo -n /usr/local/sbin/lux-host ")
    expect(result.calls).not.toContain("sudo -n bash")
    expect(result.calls).not.toContain("sudo -n true")
  })
})
