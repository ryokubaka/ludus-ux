import { execFileSync } from "node:child_process"
import { expect } from "vitest"

/** Fail unless `bash -n` accepts `script`. String checks miss `then; echo`. */
export function assertBashScript(script: string): void {
  try {
    execFileSync("bash", ["-n", "-c", script], { stdio: "pipe" })
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err ? String((err as { stderr?: Buffer }).stderr ?? "") : ""
    expect.fail(`bash -n rejected the script:\n${stderr || (err as Error).message}\n---\n${script}`)
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
