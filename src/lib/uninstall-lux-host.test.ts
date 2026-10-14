import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const uninstall = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/uninstall.sh")

function run(script: string): { status: number; output: string } {
  const result = spawnSync(
    "bash",
    ["-c", `set +e\nsource ${JSON.stringify(uninstall)}\nset +e\n${script}`],
    { encoding: "utf8" },
  )
  return { status: result.status ?? 1, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` }
}

describe("uninstall lux-host", () => {
  it("parses and prints a root-only removal command", () => {
    const syntax = spawnSync("bash", ["-n", uninstall], { encoding: "utf8" })
    expect(syntax.status).toBe(0)

    const printed = run("lux_host_uninstall_remote_script")
    expect(printed.status).toBe(0)
    expect(printed.output).toContain("must run as root")
    expect(printed.output).toContain("rm -f")
    expect(printed.output).toContain("/usr/local/sbin/lux-host")
    expect(printed.output).toContain("/etc/sudoers.d/lux-host")
    expect(printed.output).toContain("/etc/lux-host.update-key")

    const remote = spawnSync("bash", ["-n"], { input: printed.output, encoding: "utf8" })
    expect(remote.status).toBe(0)
  })

  it("refuses the root script when the caller is not root", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return
    const printed = run("lux_host_uninstall_remote_script")
    const result = spawnSync("bash", ["-s"], { input: printed.output, encoding: "utf8" })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toContain("must run as root")
  })

  it("removes only the lux-host files under a prefix", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-uninstall-"))
    mkdirSync(path.join(dir, "usr/local/sbin"), { recursive: true })
    mkdirSync(path.join(dir, "etc/sudoers.d"), { recursive: true })
    writeFileSync(path.join(dir, "usr/local/sbin/lux-host"), "helper\n")
    writeFileSync(path.join(dir, "etc/sudoers.d/lux-host"), "rule\n")
    writeFileSync(path.join(dir, "etc/lux-host.update-key"), "ab".repeat(32))
    writeFileSync(path.join(dir, "etc/keep"), "stay\n")

    const result = run(`lux_host_uninstall_apply ${JSON.stringify(dir)}; printf done`)
    expect(result.status).toBe(0)
    expect(existsSync(path.join(dir, "usr/local/sbin/lux-host"))).toBe(false)
    expect(existsSync(path.join(dir, "etc/sudoers.d/lux-host"))).toBe(false)
    expect(existsSync(path.join(dir, "etc/lux-host.update-key"))).toBe(false)
    expect(existsSync(path.join(dir, "etc/keep"))).toBe(true)
  })

  it("rejects an unknown flag without reading .env", () => {
    const result = spawnSync("bash", [uninstall, "--nope"], { encoding: "utf8" })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toContain("Unknown option")
  })
})
