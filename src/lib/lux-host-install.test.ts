import { spawnSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { decryptSettingsValueAtRest } from "./settings-value-at-rest"
import {
  buildLuxHostInstallShell,
  explainLuxHostInstallFailure,
  luxHostSelfUpdateStdin,
  luxHostSudoUsernameError,
  renderLuxHostSudoers,
  selectLuxHostInstallMode,
} from "./lux-host-install"
import { luxHostManualInstallCommand } from "./lux-host-manual-command"

const TEMPLATE = "# comment\n__LUX_SSH_USER__ ALL=(root) NOPASSWD: LUX_HOST\n"

describe("lux-host-install", () => {
  it("accepts a plain username and rejects root or metacharacters", () => {
    expect(luxHostSudoUsernameError("user")).toBeNull()
    expect(luxHostSudoUsernameError("root")).toMatch(/root/)
    expect(luxHostSudoUsernameError("user;rm")).toMatch(/plain Linux/)
    expect(luxHostSudoUsernameError("User")).toMatch(/plain Linux/)
  })

  it("substitutes only the sudoers user", () => {
    expect(renderLuxHostSudoers(TEMPLATE, "user")).toBe("# comment\nuser ALL=(root) NOPASSWD: LUX_HOST\n")
    expect(renderLuxHostSudoers(TEMPLATE, "user")).not.toContain("__LUX_SSH_USER__")
  })

  it("builds a visudo install with no shell expansions in the transmitted command", () => {
    const cmd = buildLuxHostInstallShell("aGVscGVy", "c3Vkb2Vycw==", "sudo-s")
    expect(cmd).not.toContain("\n")
    expect(cmd).not.toMatch(/\$/)
    expect(cmd).not.toContain("secret-password")
    const wrapper = Buffer.from(/printf '%s' '([^']+)'/.exec(cmd)?.[1] ?? "", "base64").toString("utf8")
    expect(wrapper).toContain("sudo -S -p '' bash /tmp/lux-host-install.sh")
    expect(wrapper).toContain("exit $status")
    const script = Buffer.from(/printf '%s' '([^']+)'/.exec(wrapper)?.[1] ?? "", "base64").toString("utf8")
    expect(script).toContain("visudo -cf")
    expect(script).toContain("mkdir -p /usr/local/sbin")
    expect(script).toContain("aGVscGVy")
    expect(script).toContain("pipefail; umask 077")
  })

  it("prefers self-update once the helper can replace itself", () => {
    expect(selectLuxHostInstallMode({
      uid: 1000,
      sudoAll: true,
      sudoHelper: true,
      helperSupportsSelfUpdate: true,
      hasUserPassword: false,
    })).toBe("self-update")
  })

  it("refreshes through the lux-host helper when that sudo is already passwordless", () => {
    expect(selectLuxHostInstallMode({
      uid: 1000,
      sudoAll: false,
      sudoHelper: true,
      helperIsLegacy: true,
      hasUserPassword: false,
    })).toBe("helper")
    expect(selectLuxHostInstallMode({
      uid: 1000,
      sudoAll: false,
      sudoHelper: true,
      helperIsLegacy: false,
      hasUserPassword: false,
    })).toBeNull()
    const dir = mkdtempSync(path.join(tmpdir(), "lux-host-install-helper-"))
    const argsFile = path.join(dir, "args")
    writeFileSync(
      path.join(dir, "sudo"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\nif [ "$1" = "-n" ] && [ "$2" = "/usr/local/sbin/lux-host" ]; then exit 0; fi\nexit 19\n`,
      { mode: 0o755 },
    )
    const cmd = buildLuxHostInstallShell("aGVscGVy", "c3Vkb2Vycw==", "helper")
    const result = spawnSync("bash", ["-c", cmd], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    })
    expect(result.status).toBe(0)
    expect(readFileSync(argsFile, "utf8").split("\n").filter(Boolean)).toEqual([
      "-n",
      "/usr/local/sbin/lux-host",
      "bash /tmp/lux-host-install.sh",
    ])
    expect(existsSync("/tmp/lux-host-install.sh")).toBe(false)
    expect(existsSync("/tmp/lux-host-install.wrap")).toBe(false)
  })

  it("still needs a password when neither root nor passwordless sudo is available", () => {
    expect(selectLuxHostInstallMode({
      uid: 1000,
      sudoAll: false,
      sudoHelper: false,
      hasUserPassword: false,
    })).toBeNull()
    expect(selectLuxHostInstallMode({
      uid: 1000,
      sudoAll: false,
      sudoHelper: false,
      hasUserPassword: true,
    })).toBe("sudo-s")
    expect(selectLuxHostInstallMode({
      uid: 0,
      sudoAll: false,
      sudoHelper: false,
      hasUserPassword: false,
    })).toBe("root")
  })

  it("returns the installer status when sudo fails and deletes the temp script", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-host-install-"))
    writeFileSync(path.join(dir, "sudo"), "#!/bin/sh\nexit 17\n", { mode: 0o755 })
    const cmd = buildLuxHostInstallShell("aGVscGVy", "c3Vkb2Vycw==", "sudo-n")
    const wrapped = `bash -c ${JSON.stringify(cmd)}`
    const result = spawnSync("sh", ["-c", wrapped], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, status: "0" },
    })
    expect(result.status).toBe(17)
    expect(existsSync("/tmp/lux-host-install.sh")).toBe(false)
    expect(existsSync("/tmp/lux-host-install.wrap")).toBe(false)
  })

  it("returns non-zero when the root installer cannot write the helper", () => {
    const cmd = buildLuxHostInstallShell(
      Buffer.from("#!/bin/sh\n").toString("base64"),
      Buffer.from("user ALL=(root) NOPASSWD: /usr/local/sbin/lux-host\n").toString("base64"),
      "root",
    )
    const result = spawnSync("bash", ["-c", cmd], { encoding: "utf8" })
    expect(result.status).not.toBe(0)
    expect(existsSync("/tmp/lux-host-install.sh")).toBe(false)
    expect(existsSync("/tmp/lux-host-install.wrap")).toBe(false)
  })

  it("explains a user that is absent from sudoers", () => {
    expect(explainLuxHostInstallFailure("user is not in the sudoers file. This incident will be reported to the administrator.", "user"))
      .toMatch(/cannot install this rule/)
  })

  it("binds a self-update body to the update key", () => {
    const key = "ab".repeat(32)
    const script = "#!/bin/bash\necho hi\n"
    const stdin = luxHostSelfUpdateStdin(script, key)
    const verify = `
import hmac, hashlib, sys
raw = sys.stdin.buffer.read()
nl = raw.find(b"\\n")
mac = raw[:nl].decode()
body = raw[nl + 1:]
key = sys.argv[1].encode()
want = sys.argv[2].encode()
got = hmac.new(key, body, hashlib.sha256).hexdigest()
sys.exit(0 if hmac.compare_digest(got, mac) and body == want else 1)
`
    const ok = spawnSync("python3", ["-c", verify, key, script], { input: stdin, encoding: "utf8" })
    expect(ok.status).toBe(0)
    const tampered = stdin.replace("echo hi", "echo no")
    const bad = spawnSync("python3", ["-c", verify, key, script], { input: tampered, encoding: "utf8" })
    expect(bad.status).toBe(1)
    expect(() => luxHostSelfUpdateStdin(script, "short")).toThrow(/invalid/)
  })

  it("reads the update key from stdin and does not print it", () => {
    const key = "cd".repeat(32)
    const cmd = buildLuxHostInstallShell("aGVscGVy", "c3Vkb2Vycw==", "root")
    expect(cmd).not.toContain(key)
    const result = spawnSync("bash", ["-c", cmd], { encoding: "utf8", input: key })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).not.toContain(key)
  })

  it("stores an update key that Settings can decrypt", () => {
    const secret = "unit-test-app-secret-32-characters"
    const key = "cd".repeat(32)
    const dir = mkdtempSync(path.join(tmpdir(), "lux-update-key-"))
    const result = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/lux-host/record-update-key.mjs")], {
      input: key,
      encoding: "utf8",
      env: { ...process.env, APP_SECRET: secret, DATA_DIR: dir },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(`${result.stdout}${result.stderr}`).not.toContain(key)
    const db = new DatabaseSync(path.join(dir, "ludus-ux.db"))
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("luxHostUpdateKey") as { value: string }
    db.close()
    expect(row.value.startsWith("enc:v2:")).toBe(true)
    expect(decryptSettingsValueAtRest(row.value, secret)).toBe(key)
  })

  it("omits sudo when the SSH account is already root", () => {
    const cmd = buildLuxHostInstallShell("aGVscGVy", "c3Vkb2Vycw==", "root")
    expect(cmd.startsWith("printf ")).toBe(true)
    expect(cmd).not.toContain("sudo")
  })
})

function scratchManualCommand(command: string, dir: string): string {
  return command
    .replace("mkdir -p /usr/local/sbin /etc/sudoers.d", `mkdir -p ${dir}/sbin ${dir}/sudoers.d`)
    .replace("cat > /usr/local/sbin/lux-host << 'LUX_HOST_FILE'", `cat > ${dir}/sbin/lux-host << 'LUX_HOST_FILE'`)
    .replace("\nchown root:root /usr/local/sbin/lux-host\n", `\ntrue ${dir}/sbin/lux-host\n`)
    .replace("\nchmod 755 /usr/local/sbin/lux-host\n", `\nchmod 755 ${dir}/sbin/lux-host\n`)
    .replace(
      "install -o root -g root -m 440 \"$tmp\" /etc/sudoers.d/lux-host",
      `install -m 440 "$tmp" ${dir}/sudoers.d/lux-host`,
    )
}

describe("luxHostManualInstallCommand", () => {
  it("rejects root and unsafe names", () => {
    expect(() => luxHostManualInstallCommand("root", "#!/bin/bash\n")).toThrow(/root/)
    expect(() => luxHostManualInstallCommand("user;rm", "#!/bin/bash\n")).toThrow(/plain Linux/)
  })

  it("installs the helper and sudoers rule from one pasted root shell", () => {
    const helper = "#!/bin/bash\necho manual-helper\n"
    const command = luxHostManualInstallCommand("testuser", helper)
    expect(command).toContain("#!/bin/bash")
    expect(command).toContain("echo manual-helper")
    expect(command).toContain("testuser ALL=(root) NOPASSWD: LUX_HOST")
    expect(command).not.toMatch(/scripts\/lux-host/)

    const dir = mkdtempSync(path.join(tmpdir(), "lux-host-manual-"))
    const result = spawnSync("bash", ["-s"], { input: scratchManualCommand(command, dir), encoding: "utf8" })
    expect(result.status).toBe(0)
    expect(readFileSync(`${dir}/sbin/lux-host`, "utf8")).toBe("#!/bin/bash\necho manual-helper\n")
    const rule = readFileSync(`${dir}/sudoers.d/lux-host`, "utf8")
    expect(rule).toContain("testuser ALL=(root) NOPASSWD: LUX_HOST")
    expect(rule).not.toContain("__LUX_SSH_USER__")
  })

  it("embeds the bundled helper so the paste does not need another file", () => {
    const helper = readFileSync(path.join(process.cwd(), "scripts/lux-host/lux-host"), "utf8")
    const command = luxHostManualInstallCommand("testuser", helper)
    const dir = mkdtempSync(path.join(tmpdir(), "lux-host-manual-bundled-"))
    const result = spawnSync("bash", ["-s"], { input: scratchManualCommand(command, dir), encoding: "utf8" })
    expect(result.status).toBe(0)
    expect(readFileSync(`${dir}/sbin/lux-host`, "utf8")).toBe(helper.replace(/\r\n/g, "\n"))
  })
})
