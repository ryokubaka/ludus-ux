/**
 * Paths for tests that spawn Bash.
 *
 * Node on Windows searches PATH with ";". Git Bash converts a Windows PATH
 * when it starts. `C:\fake:/usr/bin:/bin` does neither job: Node cannot find
 * bash.exe, and Bash treats the drive letter as its own PATH entry, so the
 * fake commands never run.
 */
import { existsSync } from "node:fs"
import path from "node:path"

export function posixPath(file: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return file
  const normalized = file.trim().replace(/\\/g, "/")
  if (/^\/[a-zA-Z]\//.test(normalized)) return normalized
  const drive = /^([A-Za-z]):\/(.*)$/.exec(normalized)
  if (!drive) return normalized
  return `/${drive[1].toLowerCase()}/${drive[2]}`
}

function shellDirs(): string[] {
  if (process.platform !== "win32") return ["/usr/bin", "/bin"]
  const dirs: string[] = []
  for (const part of (process.env.PATH ?? "").split(";")) {
    if (!part) continue
    const hasBash = existsSync(path.join(part, "bash.exe"))
    const hasId = existsSync(path.join(part, "id.exe"))
    if ((hasBash || hasId) && !dirs.includes(part)) dirs.push(part)
  }
  const system = process.env.SystemRoot ? path.join(process.env.SystemRoot, "system32") : ""
  if (system && !dirs.includes(system)) dirs.push(system)
  return dirs
}

/** `front` first, then the shell's own bin. Real python3 and node stay off this PATH. */
export function bashPath(front: string): string {
  return [front, ...shellDirs()].join(path.delimiter)
}

/** `front` first, then the full inherited PATH. The script still needs node or python3. */
export function bashPathInherit(front: string): string {
  const rest = process.env.PATH ?? ""
  if (!rest) return front
  return `${front}${path.delimiter}${rest}`
}
