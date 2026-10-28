import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect } from "vitest"

/**
 * Fail unless `bash -n` accepts `script`. String checks miss `then; echo`.
 * The script is a file, not a `bash -c` argument. Callers pass paths from the
 * environment, and those must not be part of the command line.
 */
export function assertBashScript(script: string): void {
  const dir = mkdtempSync(path.join(tmpdir(), "lux-bash-n-"))
  const file = path.join(dir, "script.sh")
  try {
    writeFileSync(file, script, "utf8")
    try {
      execFileSync("bash", ["-n", file.replace(/\\/g, "/")], { stdio: "pipe" })
    } catch (err) {
      const stderr =
        err instanceof Error && "stderr" in err ? String((err as { stderr?: Buffer }).stderr ?? "") : ""
      expect.fail(`bash -n rejected the script:\n${stderr || (err as Error).message}\n---\n${script}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The script `bash -c` runs after the remote shell parses one quote layer.
 * `bash -n` on the outer command does not parse that argument.
 */
export function bashCArgument(command: string): string {
  const marker = "bash -c "
  const at = command.indexOf(marker)
  if (at < 0) throw new Error("command has no bash -c")
  const quoted = command.slice(at + marker.length)
  return execFileSync("bash", ["-c", `printf %s ${quoted}`], { encoding: "utf8" })
}
